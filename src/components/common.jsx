import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp, fmtSize, fmtTime } from '../lib/media.js';

export function FilePicker({ accept, multiple, onFiles, label, hint }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const handle = (list) => {
    const files = Array.from(list || []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
      <strong>{label}</strong>
      <span>{hint || 'Click to choose or drag & drop here'}</span>
    </div>
  );
}

export function Slider({ label, min, max, step, value, onChange, format = (v) => v }) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

const MIN_GAP = 0.1;

export function TrimControls({ duration, start, end, onChange, getCurrentTime, onPreview }) {
  if (!duration) return <p className="muted">Could not read the duration of this file, trimming is disabled.</p>;
  const step = duration > 600 ? 0.5 : 0.05;
  const setStart = (v) => onChange({ start: clamp(v, 0, end - MIN_GAP), end });
  const setEnd = (v) => onChange({ start, end: clamp(v, start + MIN_GAP, duration) });

  return (
    <div className="trim">
      <Slider label="Start" min={0} max={duration} step={step} value={start} onChange={setStart} format={fmtTime} />
      <Slider label="End" min={0} max={duration} step={step} value={end} onChange={setEnd} format={fmtTime} />
      <div className="row wrap">
        <button className="btn small" onClick={() => setStart(getCurrentTime())}>
          Set start = playhead
        </button>
        <button className="btn small" onClick={() => setEnd(getCurrentTime())}>
          Set end = playhead
        </button>
        <button className="btn small" onClick={() => onChange({ start: 0, end: duration })}>
          Reset
        </button>
        {onPreview && (
          <button className="btn small accent" onClick={onPreview}>
            ▶ Play selection
          </button>
        )}
        <span className="muted">Selected: {fmtTime(end - start)}</span>
      </div>
    </div>
  );
}

export function Waveform({ file, duration, start, end, currentTime, onSeek }) {
  const canvasRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setStatus('File is too large for a waveform preview.');
      return;
    }
    setStatus('Drawing waveform…');
    (async () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        ctx.close();
        const data = buffer.getChannelData(0);
        const bins = 1000;
        const size = Math.max(1, Math.floor(data.length / bins));
        const stride = Math.max(1, Math.floor(size / 256));
        const out = new Float32Array(bins);
        let globalMax = 0;
        for (let i = 0; i < bins; i++) {
          let max = 0;
          const from = i * size;
          const to = Math.min(data.length, from + size);
          for (let j = from; j < to; j += stride) {
            const v = Math.abs(data[j]);
            if (v > max) max = v;
          }
          out[i] = max;
          if (max > globalMax) globalMax = max;
        }
        if (globalMax > 0) for (let i = 0; i < bins; i++) out[i] /= globalMax;
        if (!cancelled) {
          setPeaks(out);
          setStatus('');
        }
      } catch {
        if (!cancelled) setStatus('Waveform preview not available for this file.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !duration) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);

    const x0 = (start / duration) * w;
    const x1 = (end / duration) * w;
    g.fillStyle = 'rgba(138, 61, 255, 0.15)';
    g.fillRect(x0, 0, x1 - x0, h);

    const barW = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW;
      const bh = Math.max(1, peaks[i] * h * 0.9);
      g.fillStyle = x >= x0 && x <= x1 ? '#b48aff' : '#4a4f63';
      g.fillRect(x, (h - bh) / 2, Math.max(1, barW - 0.5), bh);
    }

    const px = (currentTime / duration) * w;
    g.fillStyle = '#ffffff';
    g.fillRect(px - dpr / 2, 0, dpr, h);
  }, [peaks, duration, start, end, currentTime]);

  if (!peaks) return status ? <p className="muted">{status}</p> : null;

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek?.(((e.clientX - rect.left) / rect.width) * duration);
      }}
    />
  );
}

export function useJob() {
  const [state, setState] = useState({ busy: false, progress: 0, error: '', result: null });
  const run = useCallback(async (fn) => {
    setState({ busy: true, progress: 0, error: '', result: null });
    try {
      const result = await fn((p) => setState((s) => ({ ...s, progress: p })));
      setState({ busy: false, progress: 1, error: '', result });
    } catch (e) {
      console.error(e);
      setState({ busy: false, progress: 0, error: e?.message || String(e), result: null });
    }
  }, []);
  return [state, run];
}

export function JobStatus({ job, resultActions }) {
  return (
    <>
      {job.busy && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          <span>{job.progress > 0 ? `Processing… ${Math.round(job.progress * 100)}%` : 'Preparing…'}</span>
        </div>
      )}
      {job.error && <pre className="error">{job.error}</pre>}
      {job.result && <ResultView {...job.result} actions={resultActions?.(job.result)} />}
    </>
  );
}

function ResultView({ blob, filename, actions }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return null;
  const isVideo = blob.type.startsWith('video/');
  const isImage = blob.type.startsWith('image/');

  return (
    <div className="result">
      <h3>✅ Done</h3>
      {isImage ? (
        <img src={url} alt="Result" className="player" />
      ) : isVideo ? (
        <video src={url} controls className="player" />
      ) : (
        <audio src={url} controls className="audio" />
      )}
      <div className="row wrap">
        <a className="btn accent" href={url} download={filename}>
          ⬇ Download {filename}
        </a>
        {actions}
        <span className="muted">{fmtSize(blob.size)}</span>
      </div>
    </div>
  );
}

/** Tracks the current time of a media element for waveform playheads. */
export function useCurrentTime(ref, src) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setT(0);
    let raf = 0;
    const tick = () => {
      setT(el.currentTime);
      if (!el.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('seeked', tick);
    el.addEventListener('pause', tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('seeked', tick);
      el.removeEventListener('pause', tick);
    };
  }, [ref, src]);
  return t;
}
