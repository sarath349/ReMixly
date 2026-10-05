import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

const TIME_RE = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

let loadPromise = null;
let queue = Promise.resolve();

export function loadFFmpeg() {
  if (!loadPromise) {
    const ff = new FFmpeg();
    loadPromise = ff
      .load({ coreURL, wasmURL })
      .then(() => ff)
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

async function hasAudioStream(ff, name) {
  const lines = [];
  const collect = ({ message }) => lines.push(message);
  ff.on('log', collect);
  try {
    await ff.exec(['-hide_banner', '-i', name]);
  } finally {
    ff.off('log', collect);
  }
  return lines.some((l) => /Stream #\d+:\d+.*Audio:/.test(l));
}

/** Returns FFmpeg's description of the file (duration + stream lines) and whether it has audio/video. */
export function probeMedia(file, name) {
  const job = queue.then(async () => {
    const ff = await loadFFmpeg();
    const lines = [];
    const collect = ({ message }) => lines.push(message);
    await ff.writeFile(name, await fetchFile(file));
    ff.on('log', collect);
    try {
      await ff.exec(['-hide_banner', '-i', name]);
    } finally {
      ff.off('log', collect);
      await ff.deleteFile(name).catch(() => {});
    }
    const info = lines.filter((l) => /Duration:|Stream #/.test(l)).map((l) => l.trim());
    return {
      info: info.join('\n'),
      hasAudio: info.some((l) => /Stream #.*Audio:/.test(l)),
      hasVideo: info.some((l) => /Stream #.*Video:/.test(l) && !/attached pic/.test(l)),
    };
  });
  queue = job.catch(() => {});
  return job;
}

/**
 * Runs one FFmpeg job. Jobs are queued because there is a single FFmpeg instance.
 * `build` receives helpers and must return the FFmpeg argument list.
 */
export function runFFmpeg(options) {
  const job = queue.then(() => execute(options));
  queue = job.catch(() => {});
  return job;
}

async function execute({ inputs, output, mime, duration, build, onProgress }) {
  const ff = await loadFFmpeg();
  const logs = [];
  const onLog = ({ message }) => {
    logs.push(message);
    if (logs.length > 100) logs.shift();
    const m = duration > 0 && TIME_RE.exec(message);
    if (m) {
      const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      onProgress?.(Math.min(1, Math.max(0, t / duration)));
    }
  };

  try {
    for (const { name, file } of inputs) {
      await ff.writeFile(name, await fetchFile(file));
    }
    const args = await build({ hasAudio: (name) => hasAudioStream(ff, name) });

    ff.on('log', onLog);
    const code = await ff.exec(args);
    ff.off('log', onLog);
    if (code !== 0) {
      throw Object.assign(new Error(`Processing failed:\n${logs.slice(-6).join('\n')}`), {
        ffmpegLog: logs.slice(-25).join('\n'),
      });
    }

    const data = await ff.readFile(output);
    onProgress?.(1);
    return new Blob([data], { type: mime });
  } finally {
    ff.off('log', onLog);
    for (const { name } of inputs) await ff.deleteFile(name).catch(() => {});
    await ff.deleteFile(output).catch(() => {});
  }
}

/** Common audio format so streams from different files can be joined/mixed. */
export const AFMT = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
