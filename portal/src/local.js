import { config } from './config.js';
import { allowedEmails } from './users.js';

// EXPOSURE=local: one person, this machine, no sign-in. See the spec
// 2026-09-28-jawbs-local-mode-design.md; preflight enforces the preconditions.
export function isLocal(cfg = config) {
  return String(cfg.exposure || '').trim().toLowerCase() === 'local';
}

// The one registered user, or null when there is not exactly one. Read per
// call, like every registry lookup, so an edit needs no restart.
export function localUserEmail() {
  const emails = allowedEmails();
  return emails.length === 1 ? emails[0] : null;
}

// With no sign-in, the Host header is the only thing stopping a web page the
// person visits from rebinding its own name to 127.0.0.1 and driving the API
// from their browser. So every route, static files included, answers only to
// the names this machine uses for itself, on the port actually listened on.
// Cross-site POSTs always carry Origin, so a foreign one is refused too.
export function localHostGuard(req, res, next) {
  const port = req.socket.localPort;
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (!hosts.includes(String(req.headers.host || '').toLowerCase())) {
    return res.status(403).send('Forbidden');
  }
  const origin = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD' && origin
      && !hosts.map(h => `http://${h}`).includes(String(origin).toLowerCase())) {
    return res.status(403).send('Forbidden');
  }
  next();
}
