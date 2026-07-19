import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveApplicationFolder, recordDeletion, removeFolder } from '../src/deletion.js';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'delproj-'));
  mkdirSync(join(projectDir, 'applications', 'acme-role'), { recursive: true });
  writeFileSync(join(projectDir, 'applications', 'acme-role', 'cv.pdf'), 'pdf');
  return projectDir;
}

test('derives the folder from a delivered file inside applications/<slug>/', () => {
  const projectDir = freshProject();
  const session = { files: JSON.stringify([join(projectDir, 'applications', 'acme-role', 'cv.pdf')]) };
  const folder = deriveApplicationFolder(session, { projectDir });
  assert.ok(folder && folder.endsWith(join('applications', 'acme-role')));
});

test('returns null when there are no files', () => {
  const projectDir = freshProject();
  assert.equal(deriveApplicationFolder({ files: null }, { projectDir }), null);
  assert.equal(deriveApplicationFolder({ files: '[]' }, { projectDir }), null);
});

test('rejects paths outside applications/<slug>/', () => {
  const projectDir = freshProject();
  const cases = [
    join(projectDir, 'applications', 'stray.pdf'),          // applications/ itself
    join(projectDir, 'core', 'profile.md'),                  // elsewhere in the project
    join(projectDir, 'applications', 'acme-role', 'sub', 'x.pdf'), // two levels deep
    '/etc/passwd',                                           // outside the project
  ];
  mkdirSync(join(projectDir, 'core'), { recursive: true });
  writeFileSync(join(projectDir, 'core', 'profile.md'), 'x');
  writeFileSync(join(projectDir, 'applications', 'stray.pdf'), 'x');
  mkdirSync(join(projectDir, 'applications', 'acme-role', 'sub'), { recursive: true });
  writeFileSync(join(projectDir, 'applications', 'acme-role', 'sub', 'x.pdf'), 'x');
  for (const p of cases) {
    assert.equal(deriveApplicationFolder({ files: JSON.stringify([p]) }, { projectDir }), null, p);
  }
});

test('rejects a symlink escaping the applications directory', () => {
  const projectDir = freshProject();
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'secret.pdf'), 'x');
  symlinkSync(outside, join(projectDir, 'applications', 'link-slug'));
  const session = { files: JSON.stringify([join(projectDir, 'applications', 'link-slug', 'secret.pdf')]) };
  assert.equal(deriveApplicationFolder(session, { projectDir }), null);
});

test('recordDeletion creates and appends DELETED.md, including the none found case', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'delproj-'));
  recordDeletion({ projectDir, title: 'Designer at Acme', userName: 'Sam', folderNote: 'applications/acme-role/', messageCount: 4, createdAt: '2026-07-01 10:00:00' });
  const logPath = join(projectDir, 'applications', 'DELETED.md');
  let text = readFileSync(logPath, 'utf8');
  assert.match(text, /^# Deleted applications/);
  assert.match(text, /Designer at Acme/);
  assert.match(text, /Folder removed: applications\/acme-role\//);
  assert.match(text, /Messages in session: 4/);
  recordDeletion({ projectDir, title: 'Writer at Beta', userName: 'Sam', folderNote: 'none found', messageCount: 1, createdAt: '2026-07-02 10:00:00' });
  text = readFileSync(logPath, 'utf8');
  assert.match(text, /Writer at Beta/);
  assert.match(text, /Folder removed: none found/);
  assert.equal(text.match(/^# Deleted applications/gm).length, 1);
});

test('removeFolder deletes recursively', () => {
  const projectDir = freshProject();
  const folder = join(projectDir, 'applications', 'acme-role');
  removeFolder(folder);
  assert.ok(!existsSync(folder));
});
