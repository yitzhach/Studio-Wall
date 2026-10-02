# Start a fresh Codex task

Select the GitHub repository `yitzhach/Studio-Wall`, branch `main`, and use:

> Continue Studio Wall from current main. Read AGENTS.md, HANDOFF.md and docs/plan.md first. Summarize the current state and next smallest milestone before editing. Preserve the approved dark/light design. The frontend is connected to Cloudflare, but shared studio backend integration is still pending. Do not mistake client-sharing demo settings for real sharing. Verify any changes with npm test and npm run build, update HANDOFF.md, and publish the verified source to GitHub using available authorized tools. Report any deployment that could not be verified.

Install: `npm ci`. Develop: `npm run dev`. Tests: `npm test`. Build: `npm run build`.

Cloudflare Workers Static Assets: build command `npm run build`; deploy command `npx wrangler deploy`; wrangler.jsonc points to `dist`. For a Cloudflare Pages setup instead, build command `npm run build`, output directory `dist`. Determine which product the user connected before changing configuration. The account, domain and deployment status are not available in this handoff.

No backend secrets are needed for this prototype. Do not provision a second studio database; the user is designing a shared backend for about ten apps.
