import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LOCAL_BIN = path.resolve('bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const YT_DLP = process.env.YT_DLP || (existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp');
const TIMEOUT_MS = 120_000;

const MIME = {
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
  aac: 'audio/aac',
  opus: 'audio/ogg',
};

/** Accepts reel/post links (with or without username or tracking params) and returns a canonical URL. */
function normalizeInstagramUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/\/(reel|reels|p|tv)\/([\w-]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
  return { url: `https://www.instagram.com/${kind}/${m[2]}/`, id: m[2] };
}

function cookieArgs() {
  if (process.env.IG_COOKIES_FILE) return ['--cookies', process.env.IG_COOKIES_FILE];
  if (process.env.IG_COOKIES_BROWSER) return ['--cookies-from-browser', process.env.IG_COOKIES_BROWSER];
  return [];
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new Error('yt-dlp is not installed. Run "npm run setup" in the project folder, then restart.')
          : err
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(explainError(stderr) || `yt-dlp exited with code ${code}`));
    });
  });
}

function explainError(stderr) {
  const line = stderr.split('\n').filter((l) => l.includes('ERROR')).pop() || stderr.trim().split('\n').pop();
  if (/login|rate.?limit|cookies|private/i.test(stderr)) {
    return (
      `${line}\n\nInstagram wants you to be logged in for this reel. Log in to instagram.com in Chrome, ` +
      'then restart the app with: npm run dev:chrome'
    );
  }
  return line;
}

async function downloadReelAudio(rawUrl) {
  const target = normalizeInstagramUrl(rawUrl);
  if (!target) throw Object.assign(new Error('Not a valid Instagram reel/post link.'), { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), 'reel-'));
  try {
    const uploader = await runYtDlp([
      '--no-playlist',
      '--no-warnings',
      '--no-simulate',
      '-f', 'bestaudio/best',
      '-o', path.join(dir, '%(id)s.%(ext)s'),
      '--print', 'after_move:%(uploader|reel)s',
      ...cookieArgs(),
      target.url,
    ]);
    const [file] = await readdir(dir);
    if (!file) throw new Error('Download finished but no file was produced.');
    const ext = path.extname(file).slice(1).toLowerCase();
    const safeUploader = (uploader.split('\n').pop() || 'reel').replace(/[^\w.-]+/g, '_').slice(0, 40);
    return {
      data: await readFile(path.join(dir, file)),
      mime: MIME[ext] || 'application/octet-stream',
      filename: `${safeUploader}-${target.id}.${ext}`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
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

async function handler(req, res, next) {
  if (!req.url.startsWith('/api/reel-audio')) return next();
  const sendError = (status, message) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: message }));
  };
  if (req.method !== 'POST') return sendError(405, 'Use POST');

  try {
    const { url } = await readJson(req);
    const { data, mime, filename } = await downloadReelAudio(url);
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Filename', encodeURIComponent(filename));
    res.end(data);
  } catch (err) {
    sendError(err.status || 500, err.message);
  }
}

/** Vite plugin exposing POST /api/reel-audio { url } in both dev and preview servers. */
export function reelAudioPlugin() {
  return {
    name: 'reel-audio',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
