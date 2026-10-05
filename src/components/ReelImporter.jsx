import { useState } from 'react';

async function fetchReelAudio(url) {
  const res = await fetch('/api/reel-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get('X-Filename') || 'reel-audio.m4a');
  return new File([blob], name, { type: blob.type });
}

const STATUS_ICON = { waiting: '⏳', loading: '⬇️', done: '✅', error: '❌' };

export default function ReelImporter({ onFile }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const urls = [...new Set(text.split(/\s+/).filter((s) => s.startsWith('http')))];

  const setRow = (i, patch) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const importAll = async () => {
    setBusy(true);
    setRows(urls.map((url) => ({ url, status: 'waiting', message: '' })));
    const failed = [];
    for (let i = 0; i < urls.length; i++) {
      setRow(i, { status: 'loading', message: 'Fetching audio…' });
      try {
        const file = await fetchReelAudio(urls[i]);
        await onFile(file);
        setRow(i, { status: 'done', message: file.name });
      } catch (e) {
        failed.push(urls[i]);
        setRow(i, { status: 'error', message: e.message });
      }
    }
    setText(failed.join('\n'));
    setBusy(false);
  };

  return (
    <div className="sub">
      <strong>📸 Or paste Instagram reel links</strong>
      <textarea
        className="textarea"
        rows={4}
        placeholder={'https://www.instagram.com/reel/ABC123/\nhttps://www.instagram.com/reel/XYZ789/'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <button className="btn accent" onClick={importAll} disabled={busy || urls.length === 0}>
        {busy ? 'Fetching…' : `Get audio from ${urls.length || ''} reel${urls.length === 1 ? '' : 's'}`}
      </button>
      {rows.length > 0 && (
        <ul className="reel-status">
          {rows.map((r) => (
            <li key={r.url} className={r.status}>
              <span>{STATUS_ICON[r.status]}</span>
              <span className="name" title={r.url}>{r.url}</span>
              {r.message && <pre className="msg">{r.message}</pre>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        Only download audio you have the right to use. Instagram&apos;s terms restrict downloading other
        people&apos;s content.
      </p>
    </div>
  );
}
