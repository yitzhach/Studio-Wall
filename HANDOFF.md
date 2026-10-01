# Studio Wall handoff

## Goal and design
GitHub: yitzhach/Studio-Wall. An image-first private inspiration workspace, later sharing client mood boards through the studio-wide backend. Approved direction: Dark Gallery default + identical light mode, Focus View for pins. TypeScript/Vite with a small vanilla UI, idb and Vitest. Cloudflare backend belongs to a separate, unfinished multi-app platform.

## Completed in this working model
Responsive phone/desktop UI, board management, pin/image/idea/link saving and editing, palette extraction, device-local persistence, transactional action log/outbox, board ZIP export/import, offline shell, theme preference, optional labeled generated sample. Client board preview with local comments and local contributions; no live link or login.

## Verified
Six data-layer tests and one DOM integration flow cover transaction persistence, rollback, URL safety, versioned move/soft delete, blocked sharing, cover ownership, board/create/save/edit, theme and client feedback. Production TypeScript/Vite build. No real browser screenshot QA or physical iPhone acceptance test completed in this environment; browser-control skill was unavailable.

## Next priorities
1. Open the private review URL on iPhone; try sample, upload 3 images/camera, inspect palettes/credits, close/reopen, install to Home Screen and test airplane mode. Verify static shell caching under chosen host authentication.
2. Validate actual share-sheet receiving support on target browsers before implementing Web Share Target. iPhone support must not be assumed. Native camera picker and file import exist now.
3. Backend contract: studio identity, asset registry/file_ref, actor identity, API actions, outbox idempotency/revisions/conflicts, authorized image delivery. Do not send existing provisional events until migration semantics are settled.
4. Client access: revocable/expiring board links, server-enforced view/comment/contribute roles, guest identity, optional login. Comments and contributions must be scoped by board. Do not treat the preview UI as access control.
5. Connect AI through the same authorized action endpoint. Never give an assistant direct database/bucket access.
6. Improve search from exact palette hex to perceptual colour families if desired. Improve multi-file and ZIP import to all-or-nothing batch transactions before large-scale use. Soft-deleted blobs currently retained for future sync; design tombstone retention and cleanup.

## Useful commands
npm ci; npm test; npm run build; npm run dev.
Cloudflare deployment later: npm run build then npx wrangler deploy (requires user's account setup).

## Data caveats
Local data may be evicted by the browser; export backups. URL saves retain URL only, not fetched remote image bytes. Shared-link visibility cannot be activated by local actions. Every device has independent data until backend integration. Source spec artifact was unavailable; data shapes follow the brief, not a verified shared SDK schema.
