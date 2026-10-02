# Studio Wall handoff

Updated: 2026-10-02. Start here in a new chat; no old conversation is needed.

## Latest update — history, quick notes/links, and image markup (2026-10-02)
- Added visible **Back** and **Forward** controls for moving through Studio Wall board/app navigation, independent of the browser chrome.
- Added **Undo** and **Redo** controls plus Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z. The current offline prototype keeps up to 30 metadata states in memory for the session and restores boards, pins, annotations and feedback. Image blobs are intentionally retained so undo/redo of image saves can restore references without re-uploading. History resets on reload.
- Important backend transition: the in-memory history is a local UX layer only. When sync is enabled, undo/redo must become authorized inverse actions/revisions through the shared API rather than silently rewriting server state or the outbox.
- The main **+ Add** button now opens a fast chooser: Image/photo, **Note / idea**, or **Link**. Notes and links become first-class board cards, not comments hidden inside an image. They can be searched, selected, copied/moved, exported and later shared with a client.
- Added image **Mark up / annotate** from the reference detail view. Tools: freehand pen, circle and arrow. Each mark can carry a comment, is stored as normalized vector data on the pin, can be deleted, and overlays the image without baking pixels into the original artwork. This keeps markup editable and lightweight for the future backend.
- Annotation backend shape is deliberately simple: pin.annotations[] with tool, normalized points and comment. Future multi-user work should add actor, timestamps, permissions and revision/conflict handling; client annotations should travel through the same authorized board-scoped action API.
- Real mouse/touch drawing QA, visual alignment on unusual image aspect ratios, and Cloudflare deployment remain to be verified.

## Previous update — compressed PDF + share-link direction (2026-10-02)
- Present / PDF now offers **Download small PDF** as the primary attachment export. It builds a 2×2 contact-sheet layout at 1275×1650 px per page, rasterizes each page once, JPEG-compresses at 0.76 quality, and writes a minimal JPEG-only PDF locally in the browser. This avoids Safari/browser Print-to-PDF re-encoding each source image at unexpectedly large sizes.
- The existing browser print route remains available as **Print / full-quality PDF** for cases where file size matters less.
- Small PDF reports the generated size after download. It uses selected references when a selection exists, otherwise the visible/filtered board, matching the existing Present / PDF scope.
- No external PDF dependency was added; the writer is local/offline and has a unit test for PDF structure. Real visual/file-size QA on iPhone and desktop is still required.
- **Primary future client sharing remains a live board URL, not a PDF.** When the shared backend is connected, Collaborate should create a revocable board-scoped URL that can be copied into Messages/email. The board route must return server-rendered Open Graph/Twitter metadata (title, short description, canonical URL, and an authorized/public preview image) so iMessage/email/social clients can show a rich link card/thumbnail.
- Link-preview image should default to the board cover pin, with a generated board collage fallback. Because link-preview crawlers cannot use the signed-in SPA session, public/password/private modes need an explicit preview policy: public may expose the chosen preview derivative; private should use a generic Studio Wall card unless the product deliberately creates a safe non-sensitive preview endpoint. Never leak private board media merely to make a thumbnail.
- Cloudflare backend target: canonical optimized assets in the shared bucket/registry; a share record maps a random/revocable token to board + role + expiry; a server/Worker board route renders OG metadata and then loads the client board UI. PDF attachment generation can continue client-side from authorized derivatives.

## Previous update — image normalization for smaller storage/sharing (2026-10-02)
- New image uploads are normalized in the browser before local persistence: decoded source images are resized to a maximum 2400 px on the long edge and encoded as WebP at 0.82 quality. This applies to picker, camera, drag/drop and pasted image files because they all pass through the same save path.
- JPEG, PNG and WebP are supported by normal browser decoding. HEIC/HEIF is accepted by the picker and works when the current browser/device can decode it; unsupported HEIC/HEIF fails with a clear conversion message rather than storing a giant original.
- The local IndexedDB file blob is now the optimized WebP, so board ZIP exports and browser Print / Save PDF presentations use the smaller normalized image rather than the original upload. Existing already-saved images are not retroactively migrated.
- Temporary ingest guard is 50 MB per source file before conversion. Stored dimensions are capped by pixels rather than an arbitrary post-conversion byte target so artwork detail remains predictable.
- Backend transition: keep this browser optimization for responsiveness, but the shared Cloudflare/studio backend must treat it as a convenience only. On upload, server-side processing should validate/decode the source, strip metadata, enforce the same max 2400 px long edge, generate a canonical WebP (plus thumbnail variants as needed), store that canonical asset in the shared bucket/asset registry, and return the permanent file_ref. Never trust client MIME, dimensions or claimed conversion. Existing provisional local file_ref/action shapes remain the migration seam.
- Sharing later should reference authorized canonical assets rather than attaching originals. For email/text, prefer a board link once sharing exists; when an actual attachment/export is requested, build it from the normalized/canonical derivatives.
- Physical iPhone HEIC acceptance, visual quality, PDF-size reduction and Cloudflare rollout still need real-device QA.

## Previous update — wider selection start area (2026-10-02)
- Selection can now start in the workspace side gutters and blank space above/below the grid, rather than only the narrow image-edge padding. Increased top/bottom grid padding.
- Image/card dragging and toolbar controls remain excluded from selection-box starts.
- Validation: 12 tests and production build pass; test covers starting 40px outside the grid and excluding controls. Cloudflare rollout and physical browser QA remain unverified.

## Previous update — mouse selection (2026-10-01)
- Restored clean cards by default: selection circles appear only after choosing Select. Cmd/Ctrl-click and Shift-click remain available.
- Left-click and drag from whitespace around/between references to draw a rectangular selection box. Intersecting cards highlight live; drag any highlighted card onto a board to copy/move the selected group.
- Shift/Cmd/Ctrl while starting a box preserves the previous selection. Escape or pointer cancellation restores it. Clicking blank grid space clears it. Card drags and touch scrolling keep their previous behavior; touch selection uses Select.
- Added grid-edge whitespace so a selection can start outside the first/last image. No freehand lasso or edge auto-scroll is implemented.
- Validation: 12 tests pass and production build passes; physical browser/device QA remains pending.

## Previous update — selection, viewer and client presentation
- User confirmed the Cloudflare frontend is live. Backend integration is still pending. This update has not been independently verified on Cloudflare.
- Direct selection circles on every reference, Cmd/Ctrl-click toggles and Shift-click ranges; drag any selected reference to move/copy the group. Drag badge shows the count. Touch users can tap circles and use Copy / move.
- Opening a board, completing a transfer, or saving references opens its image/reference grid with search/filter reset; board navigation clears selection mode.
- Detail viewer adds zoom (100–400%) and Fit. Expand gallery opens a dark viewport-filling carousel with arrow keys/buttons, zoom, double-click zoom, and single-finger swipe when fitted. Native fullscreen is offered where supported; viewport mode works without it.
- Present / PDF includes explicitly selected references, otherwise the currently visible filtered collection. Clear filters and selection for the complete board. Browser print/save-PDF produces a client presentation with titles, credits and text references; private image notes are omitted. It is an attachment workflow, not a live share link.
- Local client-feedback preview adds stars and per-reference notes; Starred filter and card markers expose favorites. View-only preview hides comment controls; all identity and permissions remain demonstrations. feedback.star and feedback.add run through action(), validate pin/board membership, and log in the provisional outbox.
- Save dialog explains current browser capture: image files/paste on desktop and Safari save-to-Photos then multi-upload on iPhone. Right-click extension and Safari Share Sheet Shortcut are future work; neither is installed or implemented.
- Validation: 11 tests pass (9 data, 1 expanded UI flow, 1 viewer/presentation); npm run build passes. Real-browser QA was attempted but Chromium download returned invalid archives. Visual/print QA, actual drag behavior and physical iPhone testing remain open; DOM tests are not proof of these.

## Previous update
- Multi-select from All inspiration or any board, select visible, clear selection, copy/move into existing or newly created boards.
- Desktop drag pins (or selected groups) onto board names or board cards; opens copy/move confirmation. Touch users use Select and Copy / move. Pin focus also offers Copy / move.
- Bulk operations run atomically. Copies use new ULIDs and retain the same file_ref, notes, palette and credit; originals remain intact.
- Collaborate saves local demo preferences: public link, private invitation (verified invited identity), password-protected link; view/comment/contribute roles. No live link, password storage, or server protection exists.
- Try collaboration demo in the desktop sidebar; on an empty collection use Try a sample board. It creates sample references and a Client · Living room destination. Existing sample boards are reused.
- AGENTS.md and docs/CODEX_START.md prepare a fresh Codex session.
- User connected GitHub to Cloudflare and subsequently confirmed the frontend is live. Account, URL and current deployment details are not recorded here.
- Private review: https://studio-wall-inspiration.sweet-box-9585.chatgpt.site


## Goal and design
GitHub: yitzhach/Studio-Wall. An image-first private inspiration workspace, later sharing client mood boards through the studio-wide backend. Approved direction: Dark Gallery default + identical light mode, Focus View for pins. TypeScript/Vite with a small vanilla UI, idb and Vitest. Cloudflare backend belongs to a separate, unfinished multi-app platform.

## Completed in this working model
Responsive phone/desktop UI, board management, pin/image/idea/link saving and editing, palette extraction, device-local persistence, transactional action log/outbox, board ZIP export/import, offline shell, theme preference, optional labeled generated sample. Client board preview with local comments and local contributions; no live link or login.

## Earlier verification
Eight data-layer tests and one DOM integration flow (nine tests total) cover transaction persistence, rollback, URL safety, versioned move/soft delete, blocked sharing, cover ownership, board/create/save/edit, theme, client feedback, bulk copy into a new board, demo sharing preferences, credit/blob preservation and rollback of invalid batches. Production TypeScript/Vite build. No real browser screenshot QA or physical iPhone acceptance test completed in this environment; browser-control skill was unavailable.

## Next priorities
0. User confirmed the earlier Cloudflare deployment. Verify this new main commit deploys, then test direct selection/group drag, detail zoom, gallery arrows/swipe, PDF printing and local stars/notes on real devices. A different hostname has separate IndexedDB data: export/import boards to transfer from the private review site.
1. Open the private review URL on iPhone; try sample, upload 3 images/camera, inspect palettes/credits, close/reopen, install to Home Screen and test airplane mode. Verify static shell caching under chosen host authentication.
2. Validate actual share-sheet receiving support on target browsers before implementing Web Share Target. iPhone support must not be assumed. Native camera picker and file import exist now.
3. Backend contract: studio identity, asset registry/file_ref, actor identity, API actions, outbox idempotency/revisions/conflicts, authorized image delivery. Do not send existing provisional events until migration semantics are settled.
4. Client access: owner-selected full board or a curated subset (scope pins and media, never the whole collection); client stars, pin notes and an owner review of favorites. Revocable/expiring board links, server-enforced view/comment/contribute roles, guest identity, optional login. Comments and contributions must be scoped by board. Do not treat the preview UI as access control.
5. Connect AI through the same authorized action endpoint. Never give an assistant direct database/bucket access.
6. Improve search from exact palette hex to perceptual colour families if desired. Improve multi-file and ZIP import to all-or-nothing batch transactions before large-scale use. Soft-deleted blobs currently retained for future sync; design tombstone retention and cleanup.

## Useful commands
npm ci; npm test; npm run build; npm run dev.
Cloudflare deployment later: npm run build then npx wrangler deploy (requires user's account setup).

## Data caveats
Local data may be evicted by the browser; export backups. URL saves retain URL only, not fetched remote image bytes. Shared-link visibility cannot be activated by local actions. Every device has independent data until backend integration. Source spec artifact was unavailable; data shapes follow the brief, not a verified shared SDK schema.

## Sharing contract to implement later
Public: anyone with the link, potentially forwarded. Private: invited, verified identities (not merely an unlisted URL). Password-protected: server-side password hashing, protected sessions and rate limiting; protect media URLs too. Access mode and collaborator role are independent. Add revoke/expiry, audit events and board-scoped contribution endpoints. AI must use these same authorized actions. Existing visibility stays private while share_settings holds local demonstration preferences.

## Repository and preview histories
GitHub and private Site source mirrors may have different commit SHAs for the same tree because GitHub connector pushes use Git objects. Fetch main before new work and compare trees rather than assuming matching commit IDs. Use fast-forward updates; never force-push over remote changes.
