import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const UPLOAD_EXTENSIONS = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'pages', 'txt', 'md'];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// Most filesystems cap a name at 255 bytes; a longer X-Filename would fail
// the write with ENAMETOOLONG. 120 leaves room for the extension and a clash
// suffix, and the stem is plain ASCII by then so characters are bytes.
const MAX_STEM = 120;

// The browser's name is untrusted: keep only the last path segment (either
// slash, since Windows browsers send backslashes), judge the type by the
// final extension alone, and allow a small plain character set in the stem.
export function safeUploadName(raw) {
  const base = String(raw || '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = base.slice(dot + 1);
  if (!UPLOAD_EXTENSIONS.includes(ext.toLowerCase())) return null;
  const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, MAX_STEM).replace(/^[.\s-]+$/, '').trim();
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
  // wx fails atomically on an existing file, so a clash is discovered by
  // trying the write rather than by checking first: two uploads racing to
  // the same candidate can't both see it free and both "win".
  const dot = name.lastIndexOf('.');
  let candidate = name;
  for (let n = 2; ; n++) {
    try {
      writeFileSync(join(real, candidate), buffer, { flag: 'wx' });
      return `core/source/${candidate}`;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      candidate = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
    }
  }
}
