import { renderMarkdown } from './markdown.js';
import { isSubmitChord } from './keys.js';
import { formatLondon } from './time.js';

const app = document.getElementById('app');
const api = (path, opts) => fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* The pill shows where the application stands, from the tracker, except while
   Claude is mid-turn. Whether the chat wants a reply is a separate axis and
   shows as the red corner badge instead, so the two stop competing for one
   element. An unknown stage renders no pill at all. A null-prototype object so a
   stage of 'constructor' or 'toString' misses rather than hitting the chain,
   matching the STAGES map in tracker.js. */
const STAGES = Object.assign(Object.create(null), {
  working: 'Jawbs is working', researching: 'Researching', applying: 'Applying',
  interviewing: 'Interviewing', hired: 'Hired', turned_down: 'Turned down',
  inactive: 'Inactive',
});
const NEEDS_REPLY = new Set(['awaiting_reply', 'needs_attention']);
const pill = s => (STAGES[s.stage] ? `<span class="pill ${s.stage}">${STAGES[s.stage]}</span>` : '');

/* navigator.platform is deprecated but still populated everywhere current; the
   userAgent fallback covers its removal. Getting this wrong only mislabels a
   tooltip, because isSubmitChord accepts both modifiers on every platform. */
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const SUBMIT_HINT = isMac ? 'Cmd+Enter' : 'Ctrl+Enter';

let TITLE = 'Job Search Portal';

async function main() {
  try {
    const meta = await (await api('/meta')).json();
    if (meta.title) TITLE = meta.title;
  } catch { /* keep the neutral default */ }
  document.title = TITLE;
  const me = await api('/me');
  if (me.status === 401) return renderLogin();
  route();
  window.onhashchange = route;
}

function route() {
  closeDocPanel?.();
  const id = location.hash.slice(1);
  if (id === 'archived') return renderArchived();
  id ? renderSession(id, true) : renderList();
}

/* A minimal bottom sheet: dimmed backdrop, panel sliding up, tap the backdrop
   to dismiss. Actions is a list of { label, run } so menus can grow later. */
function openSheet(actions) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="menu">${actions.map((a, i) =>
    `<button class="sheet-item" role="menuitem" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
  wrap.querySelectorAll('.sheet-item').forEach(b => {
    b.onclick = () => { wrap.remove(); actions[Number(b.dataset.i)].run(); };
  });
  document.body.appendChild(wrap);
  wrap.querySelector('.sheet-item')?.focus();
}

/* The documents panel is mounted on document.body rather than inside #app.
   That is load-bearing: while a session is working, renderSession reruns every
   ten seconds and rewrites app.innerHTML, which would tear an open panel out
   from under the reader mid-scroll. renderSession refreshes it in place
   instead. */
let docPanel = null;
/* Closes the currently open panel, or does nothing if none is open. Kept at
   module scope, alongside docPanel, so route() can reach it on every
   navigation (see below): a hash change must not leave the panel showing
   over an unrelated screen. */
let closeDocPanel = null;
/* The markup .doc-list was last rendered with. refreshDocPanel compares
   against this, not against list.innerHTML: a bare boolean attribute like
   `download` round-trips through innerHTML as `download=""`, and esc()'s
   `&quot;` in a document name only gets re-escaped for `&`, `<` and `>` on
   read-back, so an innerHTML comparison never matches even when nothing
   changed. Remembering what we rendered sidesteps the browser's
   serialisation entirely. */
let docPanelHtml = '';

function docRows(sessionId, docs) {
  if (!docs.length) return '<p class="muted">No documents yet.</p>';
  return docs.map(d => d.available
    ? `<a class="doc-row" href="/api/sessions/${sessionId}/documents/${d.id}" download>
         <span class="doc-name">${esc(d.name)}</span>
         <span class="muted">${formatLondon(d.delivered_at)}</span></a>`
    : `<div class="doc-row unavailable">
         <span class="doc-name">${esc(d.name)}</span>
         <span class="muted">no longer available</span></div>`).join('');
}

function refreshDocPanel(sessionId, docs) {
  if (!docPanel) return;
  /* docRows is deterministic, so only touch the DOM when the markup actually
     changed. The ten-second poll calls this every tick while a session is
     working, and an unconditional innerHTML rewrite would drop keyboard focus
     and any text selection inside the list even when nothing changed. Compare
     against docPanelHtml, the string we last wrote, rather than reading
     list.innerHTML back: see the comment on docPanelHtml for why. */
  const next = docRows(sessionId, docs);
  if (next === docPanelHtml) return;
  docPanelHtml = next;
  docPanel.querySelector('.doc-list').innerHTML = next;
}

function openDocPanel(sessionId, docs) {
  if (docPanel) return; // one panel at a time; a double-click on the opener must not orphan a second wrap
  const opener = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'doc-wrap';
  docPanelHtml = docRows(sessionId, docs);
  wrap.innerHTML = `<div class="doc-panel" role="dialog" aria-modal="true" aria-label="Documents">
    <div class="doc-head"><strong>Documents</strong>
      <button class="doc-close icon-btn" aria-label="Close">&times;</button></div>
    <div class="doc-list">${docPanelHtml}</div></div>`;
  /* Operates on the wrap it closed over, not on the shared module variable,
     so it can always remove itself and is safe to call more than once
     (route(), Escape, a backdrop click and the close button can all reach
     it). The module variables are cleared only if they still point at this
     panel, so a second panel closing cannot clobber state for a different,
     still-open one. */
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    const owned = docPanel === wrap;
    if (owned) docPanel = null;
    if (closeDocPanel === close) closeDocPanel = null;
    if (owned) docPanelHtml = ''; // so a reopened panel can't compare against a previous one's markup
    document.removeEventListener('keydown', onKey);
    /* The captured opener is #doc-btn at the moment the panel opened. While a
       session is working, the ten-second poll rewrites app.innerHTML and
       detaches it, so fall back to whichever #doc-btn is current rather than
       leaving focus stranded on <body>. */
    (opener?.isConnected ? opener : document.getElementById('doc-btn'))?.focus();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.onclick = e => { if (e.target === wrap) close(); };
  wrap.querySelector('.doc-close').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  docPanel = wrap;
  closeDocPanel = close;
  wrap.querySelector('.doc-close').focus();
}

/* Point a textarea and its button at the same submit, so the chord and a click
   do the same thing. The in-flight flag means a fast second chord cannot fire a
   second POST while the first is still going, which also covers double-clicks. */
function bindSubmit(textarea, button, run) {
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true;
    try { await run(); } finally { busy = false; }
  };
  button.onclick = go;
  textarea.onkeydown = e => {
    if (!isSubmitChord(e)) return;
    e.preventDefault();
    go();
  };
}

function renderLogin() {
  app.innerHTML = `<h1>${esc(TITLE)}</h1>
    <p>Enter your email and we will send you a login link.</p>
    <form id="login-form">
    <input id="email" name="email" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send">
    <button id="go">Send login link</button></form><p id="note" class="muted"></p>`;
  document.getElementById('login-form').onsubmit = async e => {
    e.preventDefault();
    await api('/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('email').value }) });
    document.getElementById('note').textContent = 'If that address is recognised, a login link is on its way. Check your inbox.';
  };
}

async function renderList() {
  const sessions = await (await api('/sessions')).json();
  app.innerHTML = `<div class="topbar"><h1>${esc(TITLE)}</h1>
      <button id="cog" class="icon-btn" title="Options" aria-label="Options"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>
    <div class="new-app"><strong>New application</strong>
      <textarea id="jd" placeholder="Paste the job description, or just a link to it"></textarea>
      <button id="submit" title="Send to Claude (${SUBMIT_HINT})">Send to Claude</button></div>
    <div id="list">${sessions.map(s => `
      <a class="card has-menu" href="#${s.id}"><strong>${esc(s.title)}</strong>
      <div class="meta"><span class="muted">${formatLondon(s.updated_at)}</span>${pill(s)}</div>
      ${NEEDS_REPLY.has(s.status) ? `<span class="badge-reply" aria-label="${esc(s.title)}: waiting for your reply">Reply</span>` : ''}
      <button class="dots" data-id="${s.id}" aria-label="Options for ${esc(s.title)}">&#8942;</button></a>`).join('')}</div>`;
  bindSubmit(document.getElementById('jd'), document.getElementById('submit'), async () => {
    const jd = document.getElementById('jd').value;
    if (!jd.trim()) return alert('Please paste the job description or a link to it.');
    const { id } = await (await api('/sessions', { method: 'POST', body: JSON.stringify({ jd }) })).json();
    location.hash = id;
  });
  document.getElementById('cog').onclick = () => openSheet([
    { label: 'View archived applications', run: () => { location.hash = 'archived'; } },
  ]);
  document.querySelectorAll('.dots').forEach(b => b.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    openSheet([
      { label: 'Archive application', run: async () => {
        await api(`/sessions/${b.dataset.id}/archive`, { method: 'POST' });
        renderList();
      } },
    ]);
  });
}

async function renderArchived() {
  const sessions = await (await api('/sessions?archived=1')).json();
  app.innerHTML = `<a class="back" href="#">&larr; All applications</a>
    <h1>Archived applications</h1>
    ${sessions.length ? '' : '<p class="muted">Nothing is archived.</p>'}
    <div id="list">${sessions.map(s => `
      <div class="card"><strong>${esc(s.title)}</strong><div class="muted">${formatLondon(s.updated_at)}</div>
      <div class="row">
        <button class="restore secondary" data-id="${s.id}">Restore</button>
        <button class="delete danger" data-id="${s.id}" data-title="${esc(s.title)}">Delete permanently</button>
      </div></div>`).join('')}</div>`;
  document.querySelectorAll('.restore').forEach(b => b.onclick = async () => {
    await api(`/sessions/${b.dataset.id}/restore`, { method: 'POST' });
    renderArchived();
  });
  document.querySelectorAll('.delete').forEach(b => b.onclick = async () => {
    if (!confirm(`Permanently delete "${b.dataset.title}"? This also deletes its application folder and files. This cannot be undone.`)) return;
    await api(`/sessions/${b.dataset.id}`, { method: 'DELETE' });
    renderArchived();
  });
}

let pollTimer;
/* scrollToLatest is set when the reader has just arrived at the chat or has
   just sent a reply, so the newest message and the reply box are in view rather
   than the top of a long thread. The ten-second working poll passes it falsy on
   purpose: re-rendering must not yank the page down while the reader has
   scrolled up to reread. Replacing innerHTML keeps the window scroll offset, so
   a background refresh leaves them where they were. */
async function renderSession(id, scrollToLatest = false) {
  clearInterval(pollTimer);
  const [sRes, dRes] = await Promise.all([api('/sessions/' + id), api(`/sessions/${id}/documents`)]);
  const s = await sRes.json();
  const docs = dRes.ok ? await dRes.json() : [];
  app.innerHTML = `<div class="chat-bar">
      <a class="back" href="#" aria-label="All applications">&larr;</a>
      <h1 class="chat-title" title="${esc(s.title)}">${esc(s.title)}</h1>
      ${pill(s)}
      ${docs.length ? `<button id="doc-btn" class="icon-btn" title="Documents" aria-label="Documents (${docs.length})"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="doc-count">${docs.length}</span></button>` : ''}
    </div>
    ${s.messages.map(m => {
      if (m.role === 'claude') {
        const docFooter = m.docs?.length ? `<div class="msg-docs">${m.docs.map(d =>
          d.available
            ? `<a class="msg-doc" href="/api/sessions/${id}/documents/${d.id}" download>${esc(d.name)}</a>`
            : `<span class="msg-doc unavailable">${esc(d.name)}</span>`
        ).join('')}</div>` : '';
        return `<div class="msg claude md">${renderMarkdown(m.body)}${docFooter}</div>`;
      }
      return `<div class="msg ${m.role}">${esc(m.body)}</div>`;
    }).join('')}
    ${s.status === 'working' ? '<p class="muted">Jawbs is working on this. You can close the page; it will be here when you come back.</p>' : ''}
    <textarea id="reply" placeholder="Your reply"></textarea><button id="send" title="Send (${SUBMIT_HINT})">Send</button>`;
  bindSubmit(document.getElementById('reply'), document.getElementById('send'), async () => {
    const body = document.getElementById('reply').value;
    if (!body.trim()) return;
    await api(`/sessions/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
    renderSession(id, true);
  });
  document.getElementById('doc-btn')?.addEventListener('click', () => openDocPanel(id, docs));
  refreshDocPanel(id, docs);
  // Thread content is text rendered synchronously above, so the full height is
  // known now; jump straight to the bottom with no animation so the page simply
  // appears already scrolled rather than racing through the whole conversation.
  if (scrollToLatest) window.scrollTo(0, document.body.scrollHeight);
  if (s.status === 'working') pollTimer = setInterval(() => location.hash.slice(1) === id && renderSession(id), 10000);
}

main();
