import { realpathSync, rmSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

// The portal never records which folder the agent created for an application;
// the only handle is the delivered files' paths. A folder is only eligible for
// deletion if, after resolving symlinks, it sits exactly one level below the
// user's applications/ directory.
export function deriveApplicationFolder(session, user) {
  let paths;
  try {
    paths = JSON.parse(session.files || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(paths) || !paths.length || !user?.projectDir) return null;
  let folder, appsRoot;
  try {
    folder = realpathSync(dirname(paths[0]));
    appsRoot = realpathSync(join(user.projectDir, 'applications'));
  } catch {
    return null;
  }
  if (dirname(folder) !== appsRoot) return null;
  return folder;
}

export function recordDeletion({ projectDir, title, userName, folderNote, messageCount, createdAt }) {
  const dir = join(projectDir, 'applications');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'DELETED.md');
  let entry = '';
  if (!existsSync(logPath)) {
    entry += '# Deleted applications\n\nApplications permanently deleted via the portal, recorded so a missing folder is explicable later.\n';
  }
  const day = new Date().toISOString().slice(0, 10);
  entry += `\n## ${day}: ${title}\n\nDeleted from the portal by ${userName}. Folder removed: ${folderNote}. Messages in session: ${messageCount}. Session created ${createdAt}.\n`;
  appendFileSync(logPath, entry);
}

export function removeFolder(folder) {
  rmSync(folder, { recursive: true, force: true });
}

export function folderNoteFor(folder) {
  return folder ? `applications/${basename(folder)}/` : 'none found';
}
