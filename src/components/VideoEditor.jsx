import { useRef, useState } from 'react';
import { AFMT, runFFmpeg } from '../lib/ffmpeg.js';
import { baseName, fileExt, fmtTime, loadMedia, newId, num, playRange } from '../lib/media.js';
import { FilePicker, JobStatus, Slider, TrimControls, useJob } from './common.jsx';

const RESOLUTIONS = {
  original: 'Same as first clip',
  1080: '1080p',
  720: '720p',
  480: '480p',
};

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

function outputSize(resolution, clip) {
  const w = clip.width || 1280;
  const h = clip.height || 720;
  if (resolution === 'original') return [even(w), even(h)];
  const target = Number(resolution);
  return [even((w / h) * target), target];
}

export default function VideoEditor() {
  const [clips, setClips] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [music, setMusic] = useState(null);
  const [musicMode, setMusicMode] = useState('mix');
  const [musicVolume, setMusicVolume] = useState(0.6);
  const [origVolume, setOrigVolume] = useState(1);
  const [resolution, setResolution] = useState('original');
  const [loading, setLoading] = useState(false);
  const [job, run] = useJob();
  const videoRef = useRef(null);

  const selected = clips.find((c) => c.id === selectedId) || clips[0];
  const total = clips.reduce((s, c) => s + (c.end - c.start), 0);

  const addClips = async (files) => {
    setLoading(true);
    const loaded = await Promise.all(files.map(loadMedia));
    const added = loaded.map((m) => ({ ...m, id: newId(), start: 0, end: m.duration }));
    setClips((prev) => [...prev, ...added]);
    if (!selected && added[0]) setSelectedId(added[0].id);
    setLoading(false);
  };

  const updateClip = (id, patch) => setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeClip = (id) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (clip) URL.revokeObjectURL(clip.url);
      return prev.filter((c) => c.id !== id);
    });
    if (selectedId === id) setSelectedId(null);
  };

  const moveClip = (index, dir) =>
    setClips((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const exportVideo = () =>
    run(async (onProgress) => {
      const [W, H] = outputSize(resolution, clips[0]);
      const n = clips.length;
      const inputs = clips.map((c, i) => ({ name: `v${i}.${fileExt(c.file)}`, file: c.file }));
      if (music) inputs.push({ name: `music.${fileExt(music.file)}`, file: music.file });
      const output = 'output.mp4';

      const blob = await runFFmpeg({
        inputs,
        output,
        mime: 'video/mp4',
        duration: total,
        onProgress,
        build: async ({ hasAudio }) => {
          const args = [];
          const graph = [];
          const pairs = [];

          for (let i = 0; i < n; i++) {
            const c = clips[i];
            const len = num(c.end - c.start);
            args.push('-ss', String(num(c.start)), '-t', String(len), '-i', inputs[i].name);
            graph.push(
              `[${i}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
                `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`
            );
            if (await hasAudio(inputs[i].name)) {
              graph.push(`[${i}:a]asetpts=PTS-STARTPTS,${AFMT}[a${i}]`);
            } else {
              graph.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${len},${AFMT}[a${i}]`);
            }
            pairs.push(`[v${i}][a${i}]`);
          }
          graph.push(`${pairs.join('')}concat=n=${n}:v=1:a=1[vout][acat]`);

          const keepOriginal = origVolume > 0;
          let audioOut = null;
          if (music) {
            args.push('-i', inputs[n].name);
            graph.push(`[${n}:a]${AFMT},volume=${musicVolume},apad[mus]`);
            if (musicMode === 'mix' && keepOriginal) {
              graph.push(`[acat]volume=${origVolume}[orig]`);
              graph.push(`[orig][mus]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aout]`);
            } else {
              graph.push('[acat]anullsink');
              graph.push(`[mus]atrim=duration=${num(total)}[aout]`);
            }
            audioOut = '[aout]';
          } else if (keepOriginal) {
            graph.push(`[acat]volume=${origVolume}[aout]`);
            audioOut = '[aout]';
          } else {
            graph.push('[acat]anullsink');
          }

          args.push('-filter_complex', graph.join(';'), '-map', '[vout]');
          if (audioOut) args.push('-map', audioOut, '-c:a', 'aac', '-b:a', '192k');
          args.push(
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
            '-movflags', '+faststart', '-t', String(num(total)), output
          );
          return args;
        },
      });
      return { blob, filename: `${baseName(clips[0].file)}-edited.mp4` };
    });

  return (
    <div className="panel">
      <section className="card">
        <h2>1. Add video clips</h2>
        <FilePicker
          accept="video/*"
          multiple
          onFiles={addClips}
          label={clips.length ? '+ Add more clips' : 'Choose video file(s)'}
          hint="Multiple clips will be joined in the order shown below"
        />
        {loading && <p className="muted">Reading files…</p>}
        {clips.length > 0 && (
          <ul className="list">
            {clips.map((c, i) => (
              <li
                key={c.id}
                className={c.id === selected?.id ? 'active' : ''}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="index">{i + 1}</span>
                <span className="name" title={c.file.name}>{c.file.name}</span>
                <span className="muted">
                  {fmtTime(c.start)} – {fmtTime(c.end)}
                </span>
                <span className="actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon" onClick={() => moveClip(i, -1)} disabled={i === 0} title="Move up">↑</button>
                  <button className="icon" onClick={() => moveClip(i, 1)} disabled={i === clips.length - 1} title="Move down">↓</button>
                  <button className="icon danger" onClick={() => removeClip(c.id)} title="Remove">✕</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="card">
          <h2>2. Trim clip {clips.indexOf(selected) + 1}</h2>
          <video ref={videoRef} key={selected.id} src={selected.url} controls className="player" />
          <TrimControls
            duration={selected.duration}
            start={selected.start}
            end={selected.end}
            onChange={(range) => updateClip(selected.id, range)}
            getCurrentTime={() => videoRef.current?.currentTime || 0}
            onPreview={() => playRange(videoRef.current, selected.start, selected.end)}
          />
        </section>
      )}

      {clips.length > 0 && (
        <section className="card">
          <h2>3. Audio</h2>
          <Slider
            label="Original video sound"
            min={0}
            max={2}
            step={0.05}
            value={origVolume}
            onChange={setOrigVolume}
            format={(v) => (v === 0 ? 'Muted' : `${Math.round(v * 100)}%`)}
          />
          {music ? (
            <div className="sub">
              <div className="row">
                <span className="name">🎵 {music.file.name}</span>
                <button className="btn small danger" onClick={() => setMusic(null)}>Remove</button>
              </div>
              <audio src={music.url} controls className="audio" />
              <div className="row wrap">
                <label className="radio">
                  <input type="radio" checked={musicMode === 'mix'} onChange={() => setMusicMode('mix')} />
                  Mix with original sound
                </label>
                <label className="radio">
                  <input type="radio" checked={musicMode === 'replace'} onChange={() => setMusicMode('replace')} />
                  Replace original sound
                </label>
              </div>
              <Slider
                label="Music volume"
                min={0}
                max={2}
                step={0.05}
                value={musicVolume}
                onChange={setMusicVolume}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          ) : (
            <FilePicker
              accept="audio/*,video/*"
              onFiles={async ([f]) => setMusic(await loadMedia(f))}
              label="+ Add background music (optional)"
            />
          )}
        </section>
      )}

      {clips.length > 0 && (
        <section className="card">
          <h2>4. Export</h2>
          <div className="row wrap">
            <label>
              Resolution{' '}
              <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                {Object.entries(RESOLUTIONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <span className="muted">Final length: {fmtTime(total)}</span>
          </div>
          <p className="muted">
            Video runs in your browser, so long or high-resolution videos can take a while. Pick 720p or
            480p for faster exports.
          </p>
          <button className="btn accent big" onClick={exportVideo} disabled={job.busy || total <= 0}>
            {job.busy ? 'Exporting…' : 'Export MP4'}
          </button>
          <JobStatus job={job} />
        </section>
      )}
    </div>
  );
}
