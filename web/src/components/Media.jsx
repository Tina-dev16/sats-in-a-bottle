import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

const MAX_REC_SECONDS = 120;
const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';

export function VoiceRecorder({ value, onChange }) {
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const mr = useRef(null); const stream = useRef(null); const timer = useRef(null);
  const url = useRef('');
  const [src, setSrc] = useState('');
  useEffect(() => () => { clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); if (url.current) URL.revokeObjectURL(url.current); }, []);
  useEffect(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = value ? URL.createObjectURL(value) : ''; setSrc(url.current);
  }, [value]);

  async function start() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setErr('Recording isn’t supported in this browser. Upload an audio file instead.');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => { stream.current.getTracks().forEach((t) => t.stop()); onChange(new Blob(chunks, { type: r.mimeType || 'audio/webm' })); };
      r.start(); mr.current = r; setRec(true); setSecs(0);
      timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_REC_SECONDS) stop(); return s + 1; }), 1000);
    } catch { setErr('Microphone access was blocked. Allow it in your browser, or upload a file.'); }
  }
  function stop() { clearInterval(timer.current); if (mr.current?.state === 'recording') mr.current.stop(); setRec(false); }

  return (
    <div className="card mist sm stack-sm">
      <div className="row between wrap-r"><b>Voice note</b><span className="mono muted">optional</span></div>
      {src && !rec && <audio controls src={src} style={{ width: '100%' }} />}
      <div className="row wrap-r">
        {!rec ? <button type="button" className="btn btn-dark btn-sm" onClick={start}>{value ? 'Re-record' : 'Record'}</button>
          : <button type="button" className="btn btn-danger btn-sm" onClick={stop}>Stop</button>}
        {rec && <span className="rec"><span className="dot" /><span className="mono">{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</span></span>}
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>Upload file<input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f && f.size <= 6 * 1024 * 1024) onChange(f); else if (f) setErr('Audio must be under 6 MB'); e.target.value = ''; }} /></label>
        {value && !rec && <button type="button" className="linkbtn body-sm" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** Re-encodes to JPEG on the client: strips EXIF/GPS metadata and caps size before upload. */
async function cleanPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86));
}

export function PhotoPicker({ value, onChange }) {
  const [err, setErr] = useState('');
  const [src, setSrc] = useState('');
  useEffect(() => { if (!value) return setSrc(''); const u = URL.createObjectURL(value); setSrc(u); return () => URL.revokeObjectURL(u); }, [value]);
  return (
    <div className="card mist sm stack-sm">
      <div className="row between wrap-r"><b>Photo</b><span className="mono muted">optional</span></div>
      {src && <img src={src} alt="Selected" style={{ borderRadius: 16, maxHeight: 220, objectFit: 'cover', width: '100%' }} />}
      <div className="row">
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>{value ? 'Change photo' : 'Add photo'}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { onChange(await cleanPhoto(f)); setErr(''); } catch { setErr('Could not read that image'); } }} /></label>
        {value && <button type="button" className="linkbtn body-sm" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export async function uploadMedia(bottleId, blob) {
  const fd = new FormData();
  fd.append('file', blob, blob.name || 'upload');
  return api('POST', `/bottles/${bottleId}/attachments`, fd);
}
