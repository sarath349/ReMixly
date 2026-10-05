import { useState } from 'react';
import { AFMT, runFFmpeg } from '../lib/ffmpeg.js';
import { fileExt, fmtTime, loadMedia, newId, num } from '../lib/media.js';
import { FORMATS } from './AudioEditor.jsx';
import { FilePicker, JobStatus, Slider, useJob } from './common.jsx';
import ReelImporter from './ReelImporter.jsx';

export default function AudioMerger() {
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState('join');
  const [crossfade, setCrossfade] = useState(0);
  const [format, setFormat] = useState('mp3');
  const [loading, setLoading] = useState(false);
  const [job, run] = useJob();

  const shortest = items.length ? Math.min(...items.map((it) => it.duration || 0)) : 0;
  const maxCrossfade = Math.max(0, Math.min(10, shortest - 0.1));
  const cf = items.length > 1 ? Math.min(crossfade, maxCrossfade) : 0;
  const total =
    mode === 'join'
      ? items.reduce((s, it) => s + it.duration, 0) - cf * Math.max(0, items.length - 1)
      : Math.max(0, ...items.map((it) => it.offset + it.duration));

  const addFiles = async (files) => {
    setLoading(true);
    const loaded = await Promise.all(files.map(loadMedia));
    setItems((prev) => [...prev, ...loaded.map((m) => ({ ...m, id: newId(), volume: 1, offset: 0 }))]);
    setLoading(false);
  };

  const update = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const remove = (id) =>
    setItems((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter((x) => x.id !== id);
    });

  const move = (index, dir) =>
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const merge = () =>
    run(async (onProgress) => {
      const fmt = FORMATS[format];
      const n = items.length;
      const inputs = items.map((it, i) => ({ name: `a${i}.${fileExt(it.file)}`, file: it.file }));
      const output = `merged.${format}`;
      const D = num(total);

      const graph = items.map((it, i) => {
        const chain = [AFMT, `volume=${it.volume}`];
        if (mode === 'mix') {
          const ms = Math.round(it.offset * 1000);
          if (ms > 0) chain.push(`adelay=${ms}|${ms}`);
          chain.push('apad', `atrim=duration=${D}`);
        }
        return `[${i}:a]${chain.join(',')}[a${i}]`;
      });
      const labels = items.map((_, i) => `[a${i}]`).join('');

      if (mode === 'mix') {
        // amix divides each input by n; inputs are padded to equal length so scaling back by n gives a plain sum.
        graph.push(`${labels}amix=inputs=${n}:duration=longest:dropout_transition=0,volume=${n}[out]`);
      } else if (cf > 0) {
        let prev = 'a0';
        for (let i = 1; i < n; i++) {
          const next = i === n - 1 ? 'out' : `x${i}`;
          graph.push(`[${prev}][a${i}]acrossfade=d=${num(cf)}[${next}]`);
          prev = next;
        }
      } else {
        graph.push(`${labels}concat=n=${n}:v=0:a=1[out]`);
      }

      const blob = await runFFmpeg({
        inputs,
        output,
        mime: fmt.mime,
        duration: total,
        onProgress,
        build: async () => [
          ...inputs.flatMap((inp) => ['-i', inp.name]),
          '-filter_complex', graph.join(';'),
          '-map', '[out]',
          ...fmt.codec,
          output,
        ],
      });
      return { blob, filename: output };
    });

  return (
    <div className="panel">
      <section className="card">
        <h2>1. Add audio files</h2>
        <FilePicker
          accept="audio/*,video/*"
          multiple
          onFiles={addFiles}
          label={items.length ? '+ Add more files' : 'Choose 2 or more audio files'}
          hint="Select several files at once, or add them one by one"
        />
        <ReelImporter onFile={(file) => addFiles([file])} />
        {loading && <p className="muted">Reading files…</p>}
        {items.length > 0 && (
          <ul className="list tracks">
            {items.map((it, i) => (
              <li key={it.id}>
                <div className="row">
                  <span className="index">{i + 1}</span>
                  <span className="name" title={it.file.name}>{it.file.name}</span>
                  <span className="muted">{fmtTime(it.duration)}</span>
                  <span className="actions">
                    <a className="icon" href={it.url} download={it.file.name} title="Download this file">⬇</a>
                    <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                    <button className="icon" onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down">↓</button>
                    <button className="icon danger" onClick={() => remove(it.id)} title="Remove">✕</button>
                  </span>
                </div>
                <audio src={it.url} controls className="audio" />
                <div className="grid2">
                  <Slider label="Volume" min={0} max={2} step={0.05} value={it.volume}
                    onChange={(v) => update(it.id, { volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
                  {mode === 'mix' && (
                    <Slider label="Starts at" min={0} max={60} step={0.1} value={it.offset}
                      onChange={(v) => update(it.id, { offset: v })} format={fmtTime} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {items.length > 0 && (
        <section className="card">
          <h2>2. How to merge</h2>
          <div className="row wrap">
            <label className="radio">
              <input type="radio" checked={mode === 'join'} onChange={() => setMode('join')} />
              Join — one after another
            </label>
            <label className="radio">
              <input type="radio" checked={mode === 'mix'} onChange={() => setMode('mix')} />
              Mix — play at the same time (e.g. voice + music)
            </label>
          </div>
          {mode === 'join' && items.length > 1 && (
            <Slider label="Crossfade between files" min={0} max={maxCrossfade} step={0.1} value={cf}
              onChange={setCrossfade} format={(v) => (v === 0 ? 'Off' : `${v.toFixed(1)} s`)} />
          )}
        </section>
      )}

      {items.length > 0 && (
        <section className="card">
          <h2>3. Export</h2>
          <div className="row wrap">
            <label>
              Format{' '}
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                {Object.entries(FORMATS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
            <span className="muted">Final length: {fmtTime(total)}</span>
          </div>
          <button className="btn accent big" onClick={merge} disabled={job.busy || items.length < 2}>
            {job.busy ? 'Merging…' : items.length < 2 ? 'Add at least 2 files' : 'Merge audio'}
          </button>
          <JobStatus job={job} />
        </section>
      )}
    </div>
  );
}
