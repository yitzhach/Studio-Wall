# Studio Wall — working model

## Scope
1. Dark-first artist inspiration workspace with matching light mode.
2. Save images, links and ideas; organize boards and inspect pins.
3. Offline-first local IndexedDB records, blobs and atomic action/outbox logging.
4. Client mood-board preview with future view/comment/contribute permissions.
5. Replace local repository with shared SDK when its contract is available.

## Assumptions
Cloudflare backend is not available. Local-only saves are device-specific. Client preview is a design preview, not authentication or a live shared URL. Referenced Claude spec was unavailable; provided shapes are provisional. Text ideas use meta.kind. Sharing other creators' images requires an explicit owner decision. Never expose entire library through a board link.

## Milestones
- [x] 1. Responsive workspace, dark/light, boards, save and focus views.
- [x] 2. Typed local repository, actions, ULIDs, palette extraction, persistence tests.
- [x] 3. Client preview, local feedback, permission design, backups and offline shell.
- [x] 4. Production build, DOM interaction checks and Codex handoff. Real browser/phone QA remains open.

## Later backend contract
Asset records/file_ref point to shared media service, not direct public bucket paths. Server authorizes studio + board access and issues scoped asset URLs. Revocable expiring board invitations with view/comment/contribute roles; optional login. Guest contributions identify actor and remain scoped to board. AI uses same authorized API actions, never direct database writes. Server revision/conflict/idempotency rules must be settled before sync. Outbox is provisional and is never sent by this model.

## Device acceptance
Install on real phone, save camera/library images, close/reopen, test offline, verify palettes/credits. Web Share Target receiving must be verified per browser; do not promise iPhone share-sheet support. ZIP restore must remap IDs. Multi-device collaboration awaits backend.

## Collaboration model update (2026-10-01)
Completed: local multi-select, atomic batch copy/move, desktop board drop targets, new-board destination, local sharing-mode and role preferences. Client share links remain deferred. User connected frontend repo to Cloudflare; verify deployment before claiming it live.

## Follow-up requirements (2026-10-01)
- Completed frontend: direct multi-selection, group drag badge, destination grid reset, zoom/carousel, print/PDF presentation, and local star/per-pin-note preview.
- Next acceptance: physical desktop/iPhone checks, group drag, fullscreen/swipe, PDF pagination and image decoding. Browser install failed in the build environment; screenshots were not obtained.
- Capture extension: desktop image context-menu action with source page and creator credit where available, explicit board picker, and authorized upload. Requires separate extension packaging and a defined capture contract.
- iPhone capture: explore an Apple Shortcut exposed in Safari's Share Sheet; accept images/URLs and choose a board. Do not claim the PWA registers as an iOS share receiver. Current fallback: save images to Photos and multi-upload.
- Sharing: a whole board or explicit subset, protected media, client stars and image-specific notes, owner favorites/review view, revocation and permissions through the shared studio backend. Current PDF is a static export; feedback remains local.
