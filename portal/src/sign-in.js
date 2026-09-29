/* A turn that fails because Claude Code is not signed in is something a person
   can fix, not a fault in the portal: on your own computer you sign in, and on
   a shared portal the owner does. Either way a fresh session would fail the
   same way, so it is not retried. Its own module for the same reason as
   usage-limit.js: queue.js and the runner both import it. */

export class SignInError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignInError';
  }
}

// "Not logged in · Please run /login", as the CLI words it.
const NOT_SIGNED_IN = /not logged in|please run \/login/i;

// The error to throw instead of `err`, or null when it is not a sign-in failure.
// authFailed is set when an assistant message was marked authentication_failed.
export function toSignInError(err, { authFailed = false } = {}) {
  if (err instanceof SignInError) return err;
  const message = String(err?.message || err || '');
  if (authFailed || NOT_SIGNED_IN.test(message)) return new SignInError(message);
  return null;
}
