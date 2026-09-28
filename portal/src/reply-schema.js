// The whole shape of a portal turn, enforced by the agent SDK rather than
// recovered from prose. Every field is required and the nullable ones use
// anyOf, so the agent makes an explicit choice instead of omitting one.
// `reply` carries no minLength because structured outputs do not support
// string constraints; queue.js rejects an empty reply instead.
//
// This lives in its own module, rather than in agent.js beside the runner
// registry, because agent.js imports the runners and the runners need the
// schema. That cycle resolved only because RUNNERS is built at module
// evaluation time and every runner is a hoisted function declaration:
// rewriting one as `export const run... = async () => {}` would have turned
// an ordinary tidy-up into a TDZ ReferenceError at import.
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'title', 'awaiting_user', 'email', 'drafting_blocked'],
  properties: {
    reply: { type: 'string' },
    title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    awaiting_user: { type: 'boolean' },
    email: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['subject', 'body', 'attachments'],
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
            attachments: { type: 'array', items: { type: 'string' } },
          },
        },
        { type: 'null' },
      ],
    },
    // Set only when the ChatGPT drafting subagent could not write the copy, so
    // queue.js can hold the session with a Retry button instead of a draft.
    drafting_blocked: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'detail', 'resets_at'],
          properties: {
            kind: { type: 'string', enum: ['usage_limit', 'auth', 'error'] },
            detail: { type: 'string' },
            resets_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        { type: 'null' },
      ],
    },
  },
};
