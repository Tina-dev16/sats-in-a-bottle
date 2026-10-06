import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { seal, open } from './crypto.js';

const blobPath = (id) => path.join(config.dataDir, 'blobs', `${id.replace(/[^A-Za-z0-9_-]/g, '')}.bin`);
export const writeBlob = (id, dek, bottleId, buf) =>
  fs.writeFileSync(blobPath(id), seal(dek, buf, `att:${bottleId}:${id}`), { mode: 0o600 });
export const readBlob = (id, dek, bottleId) => open(dek, fs.readFileSync(blobPath(id)), `att:${bottleId}:${id}`);
export const deleteBlob = (id) => fs.rmSync(blobPath(id), { force: true });

/** Detect type from magic bytes, never trust the client-declared MIME type. */
export function sniff(b) {
  const h = (...a) => a.every((v, i) => b[i] === v);
  if (h(0x89, 0x50, 0x4e, 0x47)) return { kind: 'photo', mime: 'image/png' };
  if (h(0xff, 0xd8, 0xff)) return { kind: 'photo', mime: 'image/jpeg' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { kind: 'photo', mime: 'image/webp' };
  if (h(0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'voice', mime: 'audio/webm' };
  if (b.subarray(0, 4).toString() === 'OggS') return { kind: 'voice', mime: 'audio/ogg' };
  if (b.subarray(4, 8).toString() === 'ftyp') return { kind: 'voice', mime: 'audio/mp4' };
  if (b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'voice', mime: 'audio/mpeg' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE') return { kind: 'voice', mime: 'audio/wav' };
  return null;
}
