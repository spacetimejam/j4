import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from './db.js';
import { enqueue } from './queue.js';

// Setup is pending while the project's SETUP.md exists. The agent deletes it
// at the last setup task, so the portal keeps no progress state of its own.
export function setupPending(projectDir) {
  return Boolean(projectDir) && existsSync(join(projectDir, 'SETUP.md'));
}

export const SETUP_OPENING_PROMPT = 'The person has just opened Jawbs for the first time. '
  + 'Greet them warmly, explain in two or three sentences how the next few conversations will go, '
  + 'then ask the first intake question.';

export function findSetupSession(db, email) {
  return db.prepare("select * from sessions where user_email = ? and kind = 'setup' order by created_at limit 1")
    .get(email);
}

// One Getting started session per person: a second call returns the first.
// The opening turn has no user message; Claude speaks first.
export function startSetupSession(db, email) {
  return db.transaction(() => {
    const existing = findSetupSession(db, email);
    if (existing) return { id: existing.id, created: false };
    const id = newId();
    db.prepare("insert into sessions (id, user_email, title, status, kind) values (?, ?, 'Getting started', 'working', 'setup')")
      .run(id, email);
    enqueue({ sessionId: id, prompt: SETUP_OPENING_PROMPT });
    return { id, created: true };
  })();
}
