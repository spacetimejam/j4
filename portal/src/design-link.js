// The one list a person may choose a CV design from (owner decision,
// 2026-09-29). render/fetch-template.py enforces the same rule in code.
// Its own module so agent.js can import it without importing queue.js.
export const DESIGN_CATEGORY_URL = 'https://typst.app/universe/search/?kind=templates&category=cv';
