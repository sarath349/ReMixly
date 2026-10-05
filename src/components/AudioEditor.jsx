import { useRef, useState } from 'react';
import { runFFmpeg } from '../lib/ffmpeg.js';
import { baseName, fileExt, fmtTime, loadMedia, num, playRange } from '../lib/media.js';
import { FilePicker, JobStatus, Slider, TrimControls, Waveform, useCurrentTime, useJob } from './common.jsx';

export const FORMATS = {
  mp3: { label: 'MP3', mime: 'audio/mpeg', codec: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  wav: { label: 'WAV (lossless)', mime: 'audio/wav', codec: ['-c:a', 'pcm_s16le'] },
};

export default function AudioEditor() {
  const [media, setMedia] = useState(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [volume, setVolume] = useState(1);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState('mp3');
  const [job, run] = useJob();
  const audioRef = useRef(null);
  const currentTime = useCurrentTime(audioRef, media?.url);

  const selectedLen = range.end - range.start;
  const outLen = selectedLen / speed;
  const maxFade = Math.max(0, Math.min(10, outLen / 2));

  const openFile = async ([file]) => {
    if (media) URL.revokeObjectURL(media.url);
    const m = await loadMedia(file);
    setMedia(m);
    setRange({ start: 0, end: m.duration });
    setFadeIn(0);
    setFadeOut(0);
  };

  const exportAudio = () =>
    run(async (onProgress) => {
      const fmt = FORMATS[format];
      const input = `input.${fileExt(media.file)}`;
      const output = `output.${format}`;
      const fi = Math.min(fadeIn, maxFade);
      const fo = Math.min(fadeOut, maxFade);
      const filters = ['asetpts=PTS-STARTPTS'];
      if (speed !== 1) filters.push(`atempo=${speed}`);
      if (volume !== 1) filters.push(`volume=${volume}`);
      if (fi > 0) filters.push(`afade=t=in:st=0:d=${fi}`);
      if (fo > 0) filters.push(`afade=t=out:st=${num(Math.max(0, outLen - fo))}:d=${fo}`);

      const trim = media.duration ? ['-ss', String(num(range.start)), '-t', String(num(selectedLen))] : [];
      const blob = await runFFmpeg({
        inputs: [{ name: input, file: media.file }],
        output,
        mime: fmt.mime,
        duration: media.duration ? outLen : 0,
        onProgress,
        build: async () => [...trim, '-i', input, '-vn', '-af', filters.join(','), ...fmt.codec, output],
      });
      return { blob, filename: `${baseName(media.file)}-edited.${format}` };
    });

  return (
    <div className="panel">
      <section className="card">
        <h2>1. Open audio</h2>
        <FilePicker
          accept="audio/*,video/*"
          onFiles={openFile}
          label={media ? `🎵 ${media.file.name} — click to change` : 'Choose an audio file'}
          hint="MP3, WAV, M4A, OGG… You can also pick a video to extract its audio"
        />
      </section>

      {media && (
        <>
          <section className="card">
            <h2>2. Trim</h2>
            <audio ref={audioRef} src={media.url} controls className="audio" />
            <Waveform
              file={media.file}
              duration={media.duration}
              start={range.start}
              end={range.end}
              currentTime={currentTime}
              onSeek={(t) => audioRef.current && (audioRef.current.currentTime = t)}
            />
            <TrimControls
              duration={media.duration}
              start={range.start}
              end={range.end}
              onChange={setRange}
              getCurrentTime={() => audioRef.current?.currentTime || 0}
              onPreview={() => playRange(audioRef.current, range.start, range.end)}
            />
          </section>

          <section className="card">
            <h2>3. Effects</h2>
            <div className="grid2">
              <Slider label="Volume" min={0} max={3} step={0.05} value={volume} onChange={setVolume}
                format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Speed" min={0.5} max={2} step={0.05} value={speed} onChange={setSpeed}
                format={(v) => `${v.toFixed(2)}×`} />
              <Slider label="Fade in" min={0} max={maxFade} step={0.1} value={Math.min(fadeIn, maxFade)}
                onChange={setFadeIn} format={(v) => `${v.toFixed(1)} s`} />
              <Slider label="Fade out" min={0} max={maxFade} step={0.1} value={Math.min(fadeOut, maxFade)}
                onChange={setFadeOut} format={(v) => `${v.toFixed(1)} s`} />
            </div>
          </section>

          <section className="card">
            <h2>4. Export</h2>
            <div className="row wrap">
              <label>
                Format{' '}
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  {Object.entries(FORMATS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
              <span className="muted">Final length: {fmtTime(outLen)}</span>
            </div>
            <button className="btn accent big" onClick={exportAudio} disabled={job.busy}>
              {job.busy ? 'Exporting…' : `Export ${FORMATS[format].label.split(' ')[0]}`}
            </button>
            <JobStatus job={job} />
          </section>
        </>
      )}
    </div>
  );
}
