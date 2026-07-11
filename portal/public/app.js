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
  id ? renderSession(id) : renderList();
}

function renderLogin() {
  app.innerHTML = `<h1>${esc(TITLE)}</h1>
    <p>Enter your email and we will send you a login link.</p>
    <input id="email" type="email" placeholder="you@example.com" autocomplete="email">
    <button id="go">Send login link</button><p id="note" class="muted"></p>`;
  document.getElementById('go').onclick = async () => {
    await api('/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('email').value }) });
    document.getElementById('note').textContent = 'If that address is recognised, a login link is on its way. Check your inbox.';
  };
}

async function renderList() {
  const sessions = await (await api('/sessions')).json();
  app.innerHTML = `<h1>${esc(TITLE)}</h1>
    <div class="card"><strong>New application</strong>
      <textarea id="jd" placeholder="Paste the job description, or just a link to it"></textarea>
      <button id="submit">Send to Claude</button></div>
    <div id="list">${sessions.map(s => `
      <a class="card" href="#${s.id}"><span class="pill ${s.status}">${LABELS[s.status] || s.status}</span>
      <strong>${esc(s.title)}</strong><div class="muted">${s.updated_at}</div></a>`).join('')}</div>`;
  document.getElementById('submit').onclick = async () => {
    const jd = document.getElementById('jd').value;
    if (!jd.trim()) return alert('Please paste the job description or a link to it.');
    const { id } = await (await api('/sessions', { method: 'POST', body: JSON.stringify({ jd }) })).json();
    location.hash = id;
  };
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
