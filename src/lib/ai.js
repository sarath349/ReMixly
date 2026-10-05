export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (free tier available)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  groq: {
    label: 'Groq (fast, free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    keyUrl: 'https://openrouter.ai/keys',
  },
  ollama: {
    label: 'Ollama (local, offline, no key)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:7b',
    keyUrl: 'https://ollama.com/download',
  },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '', keyUrl: '' },
};

const STORAGE_KEY = 'media-studio-ai-settings';

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.provider) return saved;
  } catch {}
  const { baseUrl, model } = PROVIDERS.gemini;
  return { provider: 'gemini', baseUrl, model, apiKey: '' };
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const listModels = (settings) => post('/api/ai/models', { settings }).then((d) => d.models);

const OUTPUT_RE = /^output\.(mp4|mov|webm|mkv|gif|mp3|wav|m4a|aac|ogg|flac)$/;

export function buildSystemPrompt(files) {
  const list = files
    .map(
      (f) =>
        `- ${f.name}  (original name: "${f.file.name}", ${f.hasVideo ? 'video' : 'audio only'}` +
        `${f.hasVideo && !f.hasAudio ? ', NO audio stream' : ''}, duration ${f.duration.toFixed(2)}s` +
        `${f.width ? `, ${f.width}x${f.height}` : ''})\n${f.info.replace(/^/gm, '    ')}`
    )
    .join('\n');

  return `You are an expert video and audio editor. You turn the user's request into ONE FFmpeg command that runs in ffmpeg.wasm (FFmpeg 5.1, single-threaded, inside a web browser).

Input files available in the working directory:
${list}

Reply with JSON only, in exactly this shape:
{"explanation": "<1-3 short sentences in plain language describing the edit>", "args": ["-i", "in0.mp4", "...", "output.mp4"], "output": "output.mp4", "duration": <expected output length in seconds>}

Rules:
- "args" is the argument list WITHOUT the leading "ffmpeg". The last element must equal "output".
- Only use the input file names listed above. Each "-i" input index follows the order you list them in args.
- Output name must be "output.<ext>". Use mp4 for video results and mp3 for audio-only results unless the user asks for another format (wav, m4a, gif, webm, ogg, flac are allowed).
- Video encoding: -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -movflags +faststart. Audio in mp4: -c:a aac -b:a 192k. mp3: -c:a libmp3lame -b:a 192k. wav: -c:a pcm_s16le.
- Width and height passed to libx264 must be even, e.g. scale=trunc(iw/2)*2:trunc(ih/2)*2 or explicit even sizes.
- When joining or mixing several inputs, first normalize audio with aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo, and give every video the same size, fps (e.g. 30) and setsar=1 before concat.
- Never reference [N:a] for an input that has NO audio stream; generate silence with anullsrc=r=44100:cl=stereo plus atrim=duration=... instead.
- For trimming prefer input options (-ss START -t LENGTH before -i). For multi-input graphs use -filter_complex with labelled outputs and -map them.
- amix divides the volume by the number of inputs; add volume=N after amix (with dropout_transition=0 and equal-length padded inputs) when the user expects the original loudness.
- Text overlays (drawtext/subtitles) are NOT possible because no fonts are installed. Everything else in standard FFmpeg filters is available (crop, scale, pad, rotate/transpose, hflip, reverse/areverse, setpts/atempo speed, fade/afade, eq, hue, boxblur, volume, loudnorm, silenceremove, highpass/lowpass, acrossfade, xfade, overlay, palettegen/paletteuse for gif...).
- Keep processing light: browser encoding is slow, so avoid needlessly high resolutions.
- "duration" must be your best estimate of the output length in seconds (used for a progress bar).
- If the request cannot be done with FFmpeg or the files given, reply {"explanation": "<why, and what the user could do instead>", "args": null}.`;
}

function parsePlan(content) {
  const text = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('The AI did not return a valid plan. Try rephrasing.');
  const plan = JSON.parse(text.slice(start, end + 1));
  if (plan.args === null) return { explanation: plan.explanation || 'The AI could not do this.', args: null };
  if (!Array.isArray(plan.args) || plan.args.some((a) => typeof a !== 'string' && typeof a !== 'number')) {
    throw new Error('The AI returned an invalid command.');
  }
  const args = plan.args.map(String);
  if (args[0] === 'ffmpeg') args.shift();
  const output = String(plan.output || args[args.length - 1]);
  if (!OUTPUT_RE.test(output) || args[args.length - 1] !== output) {
    throw new Error(`The AI chose an unsupported output "${output}".`);
  }
  return { explanation: String(plan.explanation || ''), args, output, duration: Number(plan.duration) || 0 };
}

/** Sends the conversation to the AI and returns a validated plan plus the updated conversation. */
export async function requestPlan(settings, messages) {
  const { content } = await post('/api/ai/chat', { settings, messages });
  const nextMessages = [...messages, { role: 'assistant', content }];
  return { plan: parsePlan(content), messages: nextMessages };
}

export const OUTPUT_MIME = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};
