const app = document.getElementById('app');
const api = (path, opts) => fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts });
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABELS = { working: 'Claude is working', awaiting_reply: 'Your turn', done: 'Sent to your inbox, reply here with any notes', needs_attention: 'Needs attention', active: 'New' };

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
  const id = location.hash.slice(1);
  if (id === 'archived') return renderArchived();
  id ? renderSession(id) : renderList();
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
      <button id="cog" class="icon-btn" title="Options" aria-label="Options">&#9881;</button></div>
    <div class="new-app"><strong>New application</strong>
      <textarea id="jd" placeholder="Paste the job description, or just a link to it"></textarea>
      <button id="submit">Send to Claude</button></div>
    <div id="list">${sessions.map(s => `
      <a class="card has-menu" href="#${s.id}"><span class="pill ${s.status}">${LABELS[s.status] || s.status}</span>
      <strong>${esc(s.title)}</strong><div class="muted">${s.updated_at}</div>
      <button class="dots" data-id="${s.id}" aria-label="Options for ${esc(s.title)}">&#8942;</button></a>`).join('')}</div>`;
  document.getElementById('submit').onclick = async () => {
    const jd = document.getElementById('jd').value;
    if (!jd.trim()) return alert('Please paste the job description or a link to it.');
    const { id } = await (await api('/sessions', { method: 'POST', body: JSON.stringify({ jd }) })).json();
    location.hash = id;
  };
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
      <div class="card"><strong>${esc(s.title)}</strong><div class="muted">${s.updated_at}</div>
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
async function renderSession(id) {
  clearInterval(pollTimer);
  const s = await (await api('/sessions/' + id)).json();
  app.innerHTML = `<a class="back" href="#">&larr; All applications</a>
    <h1>${esc(s.title)} <span class="pill ${s.status}">${LABELS[s.status] || s.status}</span></h1>
    ${s.messages.map(m => `<div class="msg ${m.role}">${esc(m.body)}</div>`).join('')}
    ${s.files?.length ? `<div class="card"><strong>Your documents</strong>${s.files.map(f =>
      `<div><a href="/api/sessions/${id}/files/${f.idx}" download>${esc(f.name)}</a></div>`).join('')}</div>` : ''}
    ${s.status === 'working' ? '<p class="muted">Claude is working on this. You can close the page; it will be here when you come back.</p>' : ''}
    <textarea id="reply" placeholder="Your reply"></textarea><button id="send">Send</button>`;
  document.getElementById('send').onclick = async () => {
    const body = document.getElementById('reply').value;
    if (!body.trim()) return;
    await api(`/sessions/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
    renderSession(id);
  };
  if (s.status === 'working') pollTimer = setInterval(() => location.hash.slice(1) === id && renderSession(id), 10000);
}

main();
