# Studio Wall — agent instructions

Read HANDOFF.md, then docs/plan.md before editing. Work from current GitHub main; preserve existing changes. GitHub yitzhach/Studio-Wall is the primary development handoff. Keep usage modest and finish a bounded, verified slice.

- TypeScript + Vite + vanilla UI; idb; Vitest. Keep it small.
- Dark Gallery is default. Maintain matching light mode and phone usability.
- All domain writes go through action() in src/data.ts, including activity/outbox logging. Browser storage is explicitly local only.
- Never present demo share settings as access control or create fake working share URLs. Public/private/password-protected access and image delivery must be enforced by the future backend. Do not store client passwords in IndexedDB, logs, outbox, repo, or browser preferences.
- Copy pins preserves source credits and blob references; bulk operations must be atomic. Do not delete a blob still referenced by another pin.
- Check npm test and npm run build for changes to data/UI flows. Real device testing remains necessary; never claim DOM tests prove iPhone behavior.
- Keep HANDOFF.md current with completed work, known gaps, tests, and the next smallest task. Never put credentials in documentation.
- User connected this repo to Cloudflare on 2026-10-01. Do not assume deployment succeeded without provider evidence. Preserve wrangler.jsonc. The ChatGPT Site is a separate private review deployment; do not replace it or recreate its ID.
