import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const UPLOAD_EXTENSIONS = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'pages', 'txt', 'md'];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// The browser's name is untrusted: keep only the last path segment (either
// slash, since Windows browsers send backslashes), judge the type by the
// final extension alone, and allow a small plain character set in the stem.
export function safeUploadName(raw) {
  const base = String(raw || '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  if (!UPLOAD_EXTENSIONS.includes(ext.toLowerCase())) return null;
  const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^[.\s-]+$/, '').trim();
  return `${stem || 'upload'}.${ext}`;
}

function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Writes into <projectDir>/core/source/ and returns the path relative to the
// project. A clash gets -2, -3 before the extension rather than overwriting,
// because a person re-sending "CV.pdf" may mean a different file.
export function saveUpload(projectDir, rawName, buffer) {
  const name = safeUploadName(rawName);
  if (!name) throw refuse('bad_type', `allowed types: ${UPLOAD_EXTENSIONS.join(', ')}`);
  const dir = join(projectDir, 'core', 'source');
  mkdirSync(dir, { recursive: true });
  const root = realpathSync(projectDir);
  const real = realpathSync(dir);
  if (!real.startsWith(root + sep)) throw refuse('outside', 'core/source is outside the project');
  const dot = name.lastIndexOf('.');
  let candidate = name;
  for (let n = 2; existsSync(join(real, candidate)); n++) {
    candidate = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
  }
  writeFileSync(join(real, candidate), buffer, { flag: 'wx' });
  return `core/source/${candidate}`;
}
