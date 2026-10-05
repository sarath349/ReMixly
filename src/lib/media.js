const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp'];

let nextId = 1;
export const newId = () => nextId++;

export function fileExt(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'dat';
}

export function isVideoFile(file) {
  return file.type.startsWith('video/') || VIDEO_EXT.includes(fileExt(file));
}

export function baseName(file) {
  return file.name.replace(/\.[^.]+$/, '') || 'output';
}

/** Loads metadata (duration, size) and returns an object URL usable for preview. */
export function loadMedia(file) {
  return new Promise((resolve) => {
    const video = isVideoFile(file);
    const el = document.createElement(video ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      resolve({
        file,
        url,
        isVideo: video,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
      });
      el.removeAttribute('src');
      el.load();
    };

    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) return done();
      // Some recordings (e.g. MediaRecorder webm) report Infinity until seeked to the end.
      el.ontimeupdate = done;
      el.currentTime = 1e101;
    };
    el.onerror = done;
    setTimeout(done, 15000);
    el.src = url;
  });
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Plays the media element from `start` and pauses at `end`. */
export function playRange(el, start, end) {
  if (!el) return;
  const check = () => {
    if (el.currentTime >= end) {
      el.pause();
      el.removeEventListener('timeupdate', check);
    }
  };
  el.addEventListener('timeupdate', check);
  el.addEventListener('pause', () => el.removeEventListener('timeupdate', check), { once: true });
  el.currentTime = start;
  el.play();
}

export const num = (v) => Number(v.toFixed(3));
