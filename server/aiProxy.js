const trimUrl = (url) => (url || '').replace(/\/+$/, '');

function env() {
  return {
    baseUrl: trimUrl(process.env.AI_BASE_URL),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL,
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function resolveSettings(settings = {}) {
  const ENV = env();
  const baseUrl = trimUrl(settings.baseUrl || ENV.baseUrl);
  if (!baseUrl) throw Object.assign(new Error('Set the AI provider in AI settings first.'), { status: 400 });
  // Never forward the .env key to a provider other than the one it was configured for.
  const envKey = !ENV.baseUrl || ENV.baseUrl === baseUrl ? ENV.apiKey : '';
  return { baseUrl, apiKey: settings.apiKey || envKey, model: settings.model || ENV.model };
}

async function callProvider(url, apiKey, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const detail = json?.error?.message || json?.[0]?.error?.message || text.slice(0, 300);
    throw Object.assign(new Error(`AI provider error (${res.status}): ${detail}`), { status: res.status });
  }
  return json;
}

async function chat({ settings, messages }) {
  const { baseUrl, apiKey, model } = resolveSettings(settings);
  if (!model) throw Object.assign(new Error('Choose a model in AI settings.'), { status: 400 });
  const body = { model, messages, temperature: 0.2 };
  let data;
  try {
    data = await callProvider(`${baseUrl}/chat/completions`, apiKey, {
      method: 'POST',
      body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
    });
  } catch (err) {
    // Some models reject JSON mode; the prompt already asks for JSON, so retry without it.
    if (err.status !== 400 || !/response_format|json/i.test(err.message)) throw err;
    data = await callProvider(`${baseUrl}/chat/completions`, apiKey, { method: 'POST', body: JSON.stringify(body) });
  }
  return { content: data?.choices?.[0]?.message?.content ?? '' };
}

async function listModels({ settings }) {
  const { baseUrl, apiKey } = resolveSettings(settings);
  const data = await callProvider(`${baseUrl}/models`, apiKey);
  const models = (data?.data || data?.models || [])
    .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
  return { models };
}

async function config() {
  const { baseUrl, apiKey } = env();
  return { serverKeyBaseUrl: apiKey ? baseUrl || '*' : null };
}

const ROUTES = { '/api/ai/chat': chat, '/api/ai/models': listModels, '/api/ai/config': config };

async function handler(req, res, next) {
  const route = ROUTES[req.url.split('?')[0]];
  if (!route) return next();
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method !== 'POST') throw Object.assign(new Error('Use POST'), { status: 405 });
    res.end(JSON.stringify(await route(await readJson(req))));
  } catch (err) {
    res.statusCode = err.status && err.status < 600 ? err.status : 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}

/** Vite plugin: proxies OpenAI-compatible chat/models APIs so keys and CORS stay off the browser. */
export function aiProxyPlugin() {
  return {
    name: 'ai-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
