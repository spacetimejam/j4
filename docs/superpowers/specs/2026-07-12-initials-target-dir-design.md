# Setup wizard: initials-based default target directory

Date: 2026-07-12
Status: approved

## Purpose

The kit root (the cloned repo folder, now typically named `j4`) hosts one
project subfolder per person. The wizard should suggest a subfolder named
after the person's initials, and handle clashes when two people share
initials.

## Behaviour

Replaces the current default in `setup/setup.sh` (the
`$HOME/job-search-<firstname>` suggestion, lines 68-72).

1. **Initials derivation.** Take the first letter of each whitespace-separated
   word of `USER_NAME`, lowercase, strip anything outside `a-z0-9`.
   - "Sam Jackson" → `sj`
   - "Anna Marie O'Brien" → `amo`
   - "Cher" → `c`
2. **Default target.** `<KIT_DIR>/<initials>`, i.e. a subfolder of the repo
   root, matching how the first real run landed.
3. **Clash handling.** If the candidate directory already exists, extend the
   final component with successive further letters of the *last* word of the
   name: `sj` → `sja` → `sjac` → ... When the surname is exhausted (or the
   name has one word), append `2`, `3`, ... instead. The wizard prints a note,
   e.g. `sj is taken, suggesting sja`, before prompting.
4. **Still just a suggestion.** The prompt accepts any path the user types.
   The existing refuse-to-overwrite-non-empty guard remains the final check.
5. **Unchanged.** `--target` flag and `TARGET_DIR` in an answers file bypass
   all of this, exactly as now.

## Testing

Extend `setup/test/run-tests.sh`:

- Initials derivation: multi-word, punctuation, single-word names.
- Clash escalation: pre-create `sj`, expect suggested default `sja`;
  pre-create the whole surname chain, expect numeric fallback.
- Single-word clash: pre-create `c`, expect `c2`.

## Out of scope

Renaming existing folders; any change to portal or template substitution.
