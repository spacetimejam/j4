import { newId } from './db.js';
import { enqueue } from './queue.js';
import { DESIGN_CATEGORY_URL } from './design-link.js';

export { DESIGN_CATEGORY_URL };

export const DESIGN_OPENING_PROMPT = 'The person has opened "Change CV design" from the menu. '
  + 'Tell them which design they are using now (from render/templates/SOURCE.md), share the CV templates '
  + `link (${DESIGN_CATEGORY_URL}) as a markdown link, mention that an earlier design can be restored if `
  + 'render/templates-previous/ holds one, and ask which template they would like.';

export function findDesignSession(db, email) {
  return db.prepare(`select * from sessions where user_email = ? and kind = 'design' and archived = 0
    order by created_at desc limit 1`).get(email);
}

// One open CV design conversation per person: pressing the menu item again
// reopens it rather than starting a second adaptation in parallel.
export function startDesignSession(db, email) {
  return db.transaction(() => {
    const existing = findDesignSession(db, email);
    if (existing) return { id: existing.id, created: false };
    const id = newId();
    db.prepare("insert into sessions (id, user_email, title, status, kind) values (?, ?, 'CV design', 'working', 'design')")
      .run(id, email);
    enqueue({ sessionId: id, prompt: DESIGN_OPENING_PROMPT });
    return { id, created: true };
  })();
}
