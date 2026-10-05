import { useEffect, useState } from 'react';
import AIEditor from './components/AIEditor.jsx';
import AudioEditor from './components/AudioEditor.jsx';
import AudioMerger from './components/AudioMerger.jsx';
import VideoEditor from './components/VideoEditor.jsx';
import { loadFFmpeg } from './lib/ffmpeg.js';

const TABS = [
  { id: 'ai', label: '✨ AI Editor', Component: AIEditor },
  { id: 'video', label: '🎬 Video Editor', Component: VideoEditor },
  { id: 'audio', label: '🎵 Audio Editor', Component: AudioEditor },
  { id: 'merge', label: '🔗 Audio Merge', Component: AudioMerger },
];

export default function App() {
  const [tab, setTab] = useState('ai');
  const [engine, setEngine] = useState('loading');

  useEffect(() => {
    loadFFmpeg()
      .then(() => setEngine('ready'))
      .catch((e) => {
        console.error(e);
        setEngine('error');
      });
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/remixly-icon.png" alt="" className="brand-icon" />
          <div>
            <h1 className="brand-name" aria-label="ReMixly">
              Re<span className="brand-m">M</span>ixly
            </h1>
            <p className="brand-tagline">Cut. Mix. Create.</p>
          </div>
        </div>
        <span className={`engine ${engine}`}>
          {engine === 'loading' && 'Loading editing engine…'}
          {engine === 'ready' && '● Engine ready'}
          {engine === 'error' && 'Engine failed to load — refresh the page'}
        </span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {TABS.map(({ id, Component }) => (
        <div key={id} hidden={tab !== id}>
          <Component />
        </div>
      ))}

      <footer className="muted">Your files never leave your computer.</footer>
    </div>
  );
}
