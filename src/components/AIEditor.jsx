import { useState } from 'react';
import { OUTPUT_MIME, PROVIDERS, buildSystemPrompt, listModels, loadSettings, requestPlan, saveSettings } from '../lib/ai.js';
import { probeMedia, runFFmpeg } from '../lib/ffmpeg.js';
import { baseName, fileExt, fmtTime, loadMedia } from '../lib/media.js';
import { FilePicker, JobStatus, useJob } from './common.jsx';
import ReelImporter from './ReelImporter.jsx';

const EXAMPLES = [
  'Cut the first 5 seconds and add a 2 second fade out at the end',
  'Make it vertical 9:16 for Instagram Reels with a blurred background',
  'Speed up the video 1.5x (audio too)',
  'Join all the files one after another into one MP3 with a 1 second crossfade',
  'Use the audio file as background music at 30% volume under the video',
  'Extract the audio as MP3 and remove the silent parts',
  'Make a 5 second GIF from the middle of the video',
  'Normalize the loudness and remove background hiss',
];

let inputCounter = 0;

function Settings({ settings, onChange }) {
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState('');
  const preset = PROVIDERS[settings.provider];

  const loadModels = async () => {
    setStatus('Loading models…');
    try {
      const list = await listModels(settings);
      setModels(list);
      setStatus(`${list.length} models found`);
    } catch (e) {
      setStatus(e.message);
    }
  };

  return (
    <div className="sub settings">
      <label>
        Provider
        <select
          value={settings.provider}
          onChange={(e) => {
            const p = PROVIDERS[e.target.value];
            onChange({ ...settings, provider: e.target.value, baseUrl: p.baseUrl, model: p.model });
            setModels([]);
            setStatus('');
          }}
        >
          {Object.entries(PROVIDERS).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
      </label>
      <label>
        API key{' '}
        {preset.keyUrl && (
          <a href={preset.keyUrl} target="_blank" rel="noreferrer">
            {settings.provider === 'ollama' ? 'Download Ollama' : 'Get a key'}
          </a>
        )}
        <input
          type="password"
          value={settings.apiKey}
          placeholder={settings.provider === 'ollama' ? 'Not needed' : 'Paste your API key'}
          onChange={(e) => onChange({ ...settings, apiKey: e.target.value.trim() })}
        />
      </label>
      <label>
        Model
        <div className="row">
          <input
            list="ai-models"
            value={settings.model}
            onChange={(e) => onChange({ ...settings, model: e.target.value.trim() })}
          />
          <button className="btn small" onClick={loadModels}>Load models</button>
        </div>
        <datalist id="ai-models">
          {models.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>
      <label>
        API base URL
        <input value={settings.baseUrl} onChange={(e) => onChange({ ...settings, baseUrl: e.target.value.trim() })} />
      </label>
      {status && <p className="muted">{status}</p>}
      <p className="muted">Settings are saved in this browser only. The key is sent only to the provider you choose.</p>
    </div>
  );
}

export default function AIEditor() {
  const [settings, setSettingsState] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(() => !loadSettings().apiKey);
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [steps, setSteps] = useState([]);
  const [job, run] = useJob();

  const setSettings = (s) => {
    setSettingsState(s);
    saveSettings(s);
  };

  const addFiles = async (list) => {
    setAnalyzing((n) => n + list.length);
    for (const file of list) {
      try {
        const name = `in${inputCounter++}.${fileExt(file)}`;
        const [media, probe] = await Promise.all([loadMedia(file), probeMedia(file, name)]);
        setFiles((prev) => [...prev, { ...media, ...probe, name, id: name }]);
      } finally {
        setAnalyzing((n) => n - 1);
      }
    }
  };

  const removeFile = (id) =>
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return prev.filter((x) => x.id !== id);
    });

  const needsKey = settings.provider !== 'ollama' && settings.provider !== 'custom' && !settings.apiKey;
  const addStep = (step) => setSteps((prev) => [...prev, step]);

  const runPrompt = () =>
    run(async (onProgress) => {
      setSteps([]);
      let messages = [
        { role: 'system', content: buildSystemPrompt(files) },
        { role: 'user', content: prompt },
      ];
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        addStep({ type: 'info', text: attempt === 1 ? '🤖 Asking the AI…' : `🤖 Asking the AI to fix it (attempt ${attempt})…` });
        const res = await requestPlan(settings, messages);
        messages = res.messages;
        const { plan } = res;
        if (!plan.args) throw new Error(`The AI says: ${plan.explanation}`);
        addStep({ type: 'plan', text: plan.explanation, args: plan.args });

        const ext = plan.output.split('.').pop();
        try {
          const blob = await runFFmpeg({
            inputs: files.filter((f) => plan.args.includes(f.name)).map((f) => ({ name: f.name, file: f.file })),
            output: plan.output,
            mime: OUTPUT_MIME[ext],
            duration: plan.duration,
            onProgress,
            build: async () => plan.args,
          });
          const base = files[0] ? baseName(files[0].file) : 'edit';
          return { blob, filename: `${base}-ai.${ext}` };
        } catch (e) {
          if (!e.ffmpegLog || attempt === maxAttempts) throw e;
          addStep({ type: 'error', text: '⚠️ That command failed. Sending the error back to the AI…' });
          onProgress(0);
          messages = [
            ...messages,
            {
              role: 'user',
              content: `FFmpeg failed. Last log lines:\n${e.ffmpegLog}\n\nFix the problem and reply with a corrected JSON plan.`,
            },
          ];
        }
      }
    });

  const keepEditing = async ({ blob, filename }) => {
    await addFiles([new File([blob], filename, { type: blob.type })]);
  };

  return (
    <div className="panel">
      <section className="card">
        <div className="row">
          <h2 style={{ flex: 1, margin: 0 }}>AI settings</h2>
          <span className="muted">
            {PROVIDERS[settings.provider].label.split(' (')[0]} · {settings.model || 'no model'}
          </span>
          <button className="btn small" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Hide' : 'Change'}
          </button>
        </div>
        {showSettings && <Settings settings={settings} onChange={setSettings} />}
      </section>

      <section className="card">
        <h2>1. Add files</h2>
        <FilePicker
          accept="video/*,audio/*"
          multiple
          onFiles={addFiles}
          label={files.length ? '+ Add more files' : 'Choose video / audio files'}
          hint="Add everything the AI should work with (clips, music, voice…)"
        />
        <ReelImporter onFile={(file) => addFiles([file])} />
        {analyzing > 0 && <p className="muted">Analyzing {analyzing} file(s)…</p>}
        {files.length > 0 && (
          <ul className="list">
            {files.map((f) => (
              <li key={f.id} className="nocursor">
                <span className="tag">{f.name}</span>
                <span className="name" title={f.file.name}>
                  {f.hasVideo ? '🎬' : '🎵'} {f.file.name}
                </span>
                <span className="muted">
                  {fmtTime(f.duration)}
                  {f.width ? ` · ${f.width}×${f.height}` : ''}
                </span>
                <button className="icon danger" onClick={() => removeFile(f.id)} title="Remove">✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>2. Tell the AI what to do</h2>
        <textarea
          className="textarea prompt"
          rows={3}
          value={prompt}
          placeholder="e.g. Trim from 0:10 to 0:40, make it black & white and add the song as background music"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !job.busy && files.length && prompt.trim()) runPrompt();
          }}
        />
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => setPrompt(ex)}>{ex}</button>
          ))}
        </div>
        {needsKey && <p className="error">Add your API key in AI settings above first.</p>}
        <button
          className="btn accent big"
          onClick={runPrompt}
          disabled={job.busy || !files.length || !prompt.trim() || needsKey}
        >
          {job.busy ? 'Working…' : !files.length ? 'Add a file first' : '✨ Edit with AI  (⌘ + Enter)'}
        </button>

        {steps.length > 0 && (
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={`step-${s.type}`}>
                <div>{s.text}</div>
                {s.args && (
                  <details>
                    <summary>Show FFmpeg command</summary>
                    <code>ffmpeg {s.args.map((a) => (/[\s;'"[\]]/.test(a) ? `"${a}"` : a)).join(' ')}</code>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
        <JobStatus
          job={job}
          resultActions={(result) => (
            <button className="btn" onClick={() => keepEditing(result)}>
              ↻ Keep editing this result
            </button>
          )}
        />
      </section>
    </div>
  );
}
