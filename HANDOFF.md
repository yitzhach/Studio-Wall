# Studio Wall handoff

Updated: 2026-10-22. Start here in a new chat; no old conversation is needed.

## Current state (2026-10-17) — read this first
- **Live:** https://studio-wall.bobdylan2000.workers.dev (Cloudflare Worker `studio-wall`, deploys automatically from `main` via Workers Builds: `npm run build` then `npx wrangler deploy`). Whole site is behind Cloudflare Access (team `frosty-block-644b`, Owner policy = user's email, one-time PIN). PR preview builds fail instantly on non-production branches; production builds from main succeed — ignore preview failures, verify via the main build log.
- **Storage:** each browser keeps a full local copy in IndexedDB (works offline). With sync on, boards/cards/comments are also stored in D1 `studio-wall-sync` and image files in private R2 bucket `studio-wall-files` (key `email/file_ref`). So images live both locally and in Cloudflare.
- **Sync status:** PR #2 merged and deployed 2026-10-18; D1 shows pin updates arriving after the merge (seq 90, 2026-10-18 01:43 UTC). First live run (2026-10-17) — desktop uploaded 5 boards/~50 images, phone uploaded its own Inbox (7 images) + "Art Ideas", but the phone did not show desktop boards: one missing/undownloadable image aborted the whole strict merge. Fixed in PR #2 (lenient sync merge, image backfill, upload retry). **Still to confirm by the user: desktop boards + images now appear on the phone and phone items reach desktop.**
- **Deployed 2026-10-21/22:** PRs #7 (photo metadata), #8 (password links), #9 (chosen-card links) are live: the deployed Worker code contains `stripMetadata`, `sw_link`, `share_sessions` and `pin_ids` (checked 2026-10-22 via the Cloudflare connector). Workers Builds was slow and posted no check on these PRs, so verify by the deployed code, not GitHub checks. Not yet tried by the user on a device.
- **Access steps done 2026-10-22:** user created Access app "Studio Wall client links" (paths `s/*`, `api/s/*`, `assets/*` on studio-wall.bobdylan2000.workers.dev; policy "Clients" = Bypass/Everyone) and a service token "Studio Wall Shortcut" with a Service Auth policy "Shortcut" on the main app ("bobdylan2000.workers.dev"). Checked from outside without login: `/s/<token>` 200, `/api/s/<unknown 32-char token>/board` 404 "no longer active" (reaches the Worker), `/assets/*` 200; `/`, `/api/boards`, `/api/capture` still redirect to Access login. Service token itself not testable by the agent (secret stays with the user).
- **Next smallest task:** user builds the iPhone Shortcut (docs/SHARING_AND_CAPTURE.md §2) and tests it, and opens a real client link (plain, password, chosen cards) in a private window / on the phone; also verify sync, zoom, colour search, HEIC upload on real devices. After that: HANDOFF "Next priorities" (client contributions, owner favourites review; server-side resize/re-encode needs a Cloudflare Images binding, so the user's OK on setup and cost).

## Latest update — client links for chosen cards (2026-10-21)
- Select cards on a board → **Share selected** (selection bar, owner only, only inside a board) opens Collaborate for those cards; the link stores them in `shares.pin_ids` (JSON, added by `ALTER TABLE` like `password`). `POST /api/shares` takes `pin_ids` (1–500 IDs; unknown or off-board IDs are dropped; none left → 409); `GET /api/shares` returns `pin_count`.
- Every client route of such a link is limited to those cards (`inShare`/`sharedPins` in worker/index.ts): board JSON, images (a file is served only if a chosen live card uses it), stars/comments (cards outside → 404), link preview (count and cover). Comments on the whole board still show; comments on other cards don't. Cards later deleted or moved off the board drop out. Works with passwords.
- Validation: 42 tests and build pass. A throwaway harness ran the real Worker (`worker.fetch`) against an in-memory `node:sqlite` D1 stand-in with a self-signed Access JWT: 18 checks pass (create/validate links incl. 400/409, owner counts, client sees only chosen cards, other card's image and star 404, comment filtering, whole-board link unchanged, preview count, chosen cards + password, stored image stripped). Chromium with a mocked API: button hidden until Select, disabled with nothing chosen, dialog says "Send 2 cards from …", sends `pin_ids`, row shows "2 selected cards"; phone layout checked. Not tested in production.

## Previous update — password-protected client links (2026-10-21)
- Collaborate → Create client link takes an optional password (8–200 characters). Stored in `shares.password` as PBKDF2-SHA256, 20,000 rounds (≈4 ms CPU; 100,000 measured ≈18 ms, over the Workers Free plan's 10 ms per request — the round count is stored per hash, so it can rise on a paid plan), 16-byte salt (`hashPassword`/`checkPassword` in worker/index.ts); the column is added by `ALTER TABLE` in `ensureSchema` (existing databases upgrade on first request). The owner list shows "Password ·"; `GET /api/shares` returns `locked`, never the hash.
- Every `/api/s/<token>/…` route of a password link (board, images, feedback) answers 401 `{password:true}` until `POST /api/s/<token>/unlock` succeeds; that sets an HttpOnly, Secure, SameSite=Lax cookie `sw_link` scoped to `Path=/api/s/<token>`, backed by a `share_sessions` row that expires after 30 days or at the link's expiry. Revoking the link ends it. Wrong passwords are logged in `share_attempts`; 10 within 15 minutes from one IP (`cf-connecting-ip`) → 429 for that IP and link. `cleanup()` deletes expired sessions and day-old attempts.
- Client page (src/share.ts) shows a password form on 401 and reloads the board after unlocking. Link previews (OG tags) of password links are the generic "Studio Wall" card.
- Validation: 42 tests (new share-password.test.ts) and build pass. Local `wrangler dev` with local D1/R2, starting from the old `shares` layout: column added, open link unchanged; locked board/image/comment 401; wrong 400; right 200 + cookie; board and image 200 with cookie; forged cookie 401; 10 wrong → 429; generic OG for locked, named OG for open. Headless Chromium (phone size): password form, wrong-password message, unlock shows board and image, reload stays unlocked. Owner dialog checked in Chromium with a mocked API (sends `password`, row shows "Password ·", short password blocked). NOT tested: real Access bypass in production, iPhone Safari cookie behaviour.
- Not built: changing a link's password (turn off + new link), invitations by email (needs an email service and its key — the user's call).

## Previous update — hidden photo data removed on the server (2026-10-21)
- New `worker/strip.ts` (`stripMetadata`): removes GPS location, camera/lens, dates, captions, XMP/IPTC/Photoshop data, comments, MPF and anything after a JPEG's end marker (extra preview/gain-map images), PNG text/time/Exif chunks, WebP EXIF/XMP chunks (VP8X flags cleared). Pixels are never re-encoded; colour profiles (JPEG APP2 ICC, PNG iCCP, WebP ICCP), JPEG APP14 and the rotation flag (rewritten as a one-entry Exif, JPEG and PNG) stay. A file that doesn't parse cleanly is kept unchanged (previous behaviour). GIF/HEIC pass through unchanged.
- Applied when storing (`PUT /api/files`, `POST /api/capture`) and again when a client link serves an image (`/api/s/<token>/files/…`, also the link-preview image), so images stored before this change are covered without rewriting R2. Owner routes serve what is stored. Local IndexedDB copies and Export everything ZIPs are unchanged (the browser's WebP normalisation already drops metadata for uploads since 2026-10-02; older originals keep theirs locally).
- Why: the iPhone Shortcut sends JPEGs with the photo's location, and pre-2026-10-02 uploads are originals; both would otherwise reach clients through share links.
- Validation: 40 tests at the time (new strip.test.ts: JPEG big/little-endian Exif, rotation kept/dropped, scan data with stuffing and restart markers, PNG with checksum, WebP flags/size, unparseable → unchanged) and build pass; `wrangler deploy --dry-run` OK. Real files made with Pillow (baseline, progressive and multi-picture JPEG, PNG, lossy and lossless WebP, each with GPS/camera/ICC/XMP): pixels identical after stripping, no GPS or text left, ICC kept, Chromium shows JPEG/PNG rotated as before. Local `wrangler dev` with local D1/R2: a GPS-tagged JPEG through a client link comes back 200, stripped, rotation kept; owner route still 401 without Access. NOT tested with a real iPhone photo or in production.

## Previous update — client activity alerts + home-screen polish (2026-10-18)
- New client comments/stars (feedback with `author_name`, from share links) show as accent count badges on board names (sidebar and board cards) and in a "New from clients" bar on All inspiration / Boards. Opening a board marks it seen (per-device `localStorage` key `studio-wall-client-seen`, a convenience only), and comments that arrived since the last visit are highlighted "New" for that visit. When sync brings client activity, a toast names the client and board.
- Conversation copy and footer no longer claim comments are device-only; board cards drop the static "Private" label.
- iPhone home-screen: apple-touch-icon, standalone web-app capable, title and status-bar meta in index.html.
- PR #5 (share links/capture/recently deleted) deployed 2026-10-18 03:33 UTC; `/s/…` still redirects to Access login until the user adds the Bypass app (docs/SHARING_AND_CAPTURE.md).
- Validation: 34 tests and build pass; badge/toast logic not covered by an automated test (needs synced client feedback) and not seen on a device.

## Previous update — client links, iPhone capture, recently deleted (2026-10-18)
- **Client share links** (worker `/api/shares`, public `/s/<token>` + `/api/s/<token>/…`, page `share.html` + `src/share.ts`): owner creates per-board links (view / view+star+comment, expiry 7/30/90 days or never), copies/shares and turns them off from Collaborate. D1 `shares` table; 32-char random token. Public API exposes only that board's live cards via `publicPin` (no image notes, tags, markup); images served only if a live card on that board uses them. Comments/stars become `feedback` records (author_name, created_by `guest:<id>`) that sync to the owner's devices. Board `comments_enabled=false` forces view-only. Rate limit 60 messages/hour per guest. OG tags (title, description, cover image) injected by the Worker. The old demo access modes (public/private/password) were removed from the UI; "Preview the client view on this device" remains.
- **iPhone capture**: `POST /api/capture` (image bytes, or JSON/text link) into Inbox or `?board=`. Accepts an Access **service token** (no email in the JWT): only `/api/capture` and `/api/boards` (names only), owner = the single library owner in D1.
- **Recently deleted**: `recentlyDeleted()`, `pin.restore`, `board.restore` (30-day window; orphaned card → Inbox; board restores cards deleted with it). `files.purge` at app boot drops local blobs of cards deleted >30 days ago unless any live/recent card shares the file (no activity entry when nothing removed). Worker `cleanup()` does the same in R2 (at most daily, via `waitUntil` on sync pulls; `purged_files` table; a re-upload clears the mark). Sidebar + ⇄ dialog entry.
- **USER ACTION NEEDED** (not doable from the agent): Access **Bypass/Everyone** app for paths `s/*`, `api/s/*`, `assets/*` (client links), and a **service token** + Service Auth policy for the Shortcut. Steps: docs/SHARING_AND_CAPTURE.md. Until the bypass exists, client links ask for the owner's login.
- Validation: 34 tests and build pass. Local `wrangler dev` end-to-end against local D1/R2: share page OG tags; board JSON with no private fields; cross-board/deleted images 404; revoked/expired/bogus tokens 404; owner routes 401 without Access; comment, star toggle (single record, versioned), view-only 403, foreign pin 404, missing guest id 400; separate stars per guest; cleanup SQL selects only an unused >30-day file. This caught and fixed a deploy-breaking bug (a Worker module exported a constant). NOT tested: real Access bypass, real service-token JWT, the Shortcut on an iPhone, iMessage preview rendering.
- Known gaps: invite-only links (password links done 2026-10-21); client "contribute" on real links; capture does not resize (the Shortcut does); server-side re-encode (metadata stripping done 2026-10-21).

## Previous update — more image formats + all-or-nothing multi-upload (2026-10-18)
- Formats: JPEG, PNG, WebP, GIF, BMP and AVIF decode natively where the browser supports them. HEIC/HEIF falls back to `heic2any` and TIFF to `utif` when the browser can't open the file (detected by magic bytes, `sniffFormat` in media.ts). Converters are lazy chunks (heic2any ≈340 KB gzip, UTIF ≈30 KB) loaded only on demand; main bundle ≈38 KB gzip. Everything is still normalised to WebP ≤2400 px before saving, so sync/R2 only ever receive WebP.
- Picker accepts `image/*` plus .heic/.heif/.avif/.tif/.tiff/.bmp; drag/drop accepts files by extension when the browser reports no MIME type (common for HEIC on Windows/Chrome). iPhone's photo picker already converts HEIC to JPEG itself.
- Multi-image upload prepares every image first ("Preparing n of N…") and saves them with one `pin.save_batch` action — all or none.
- Validation: 32 tests (new media.test.ts for format sniffing/accept, batch upload all-or-none) and build pass. NOT verified with real HEIC/TIFF files in Chrome/Firefox — needs a real file test on desktop.
- Deployment check: PR #3 deployed (worker modified 2026-10-18 03:18 UTC).

## Previous update — colour-word search, atomic board import, upload checks, sync dot (2026-10-18)
- Search matches plain colour words from each card's palette (`src/colour.ts`: red/orange/yellow/green/teal/blue/purple/pink/brown, grey/black/white, warm/cool/neutral, light/dark), in addition to notes, tags, credits and hex codes.
- Single-board ZIP import is now one atomic `board.import` action (new IDs for board, cards and image refs; credits/notes/palettes/markup kept). A bad or incomplete ZIP leaves nothing behind. Multi-image upload: see the newer section above.
- Worker uploads: stored content type comes from the file's magic bytes (`sniffImage`: JPEG/PNG/WebP/GIF/HEIC); anything else is rejected with 415. Client header is no longer trusted. Server-side re-encode/metadata stripping is still not done.
- Phone header ⇄ button shows a sync dot (green synced, amber paused, pulsing while syncing; none when local-only) and its title carries the status text.
- UI test stubs fetch (503) so tests no longer try to reach a sync server.
- Validation: 30 tests (new colour.test.ts, single-board import atomicity, sniffImage, batch upload all-or-none) and build pass; wrangler dry-run OK. Not checked on a device.

## Previous update — touch zoom + double-tap (2026-10-17, PR #2)
- New `src/zoom.ts` (`bindTouchZoom`, `zoomAt`): two-finger pinch zoom (100–400%, anchored at the pinch midpoint), one-finger pan while zoomed, double-tap detection. Fitted images keep `touch-action: pan-y` so the detail view still scrolls; zoomed images take `touch-action: none`.
- Detail view: pinch zooms in place; double-tap (touch) or double-click (mouse) opens the full-screen gallery.
- Full-screen gallery: double-tap / double-click toggles 200% (at the tapped point) ↔ Fit; pinch zooms continuously; swipe-to-navigate only at Fit and never after a pinch. Mouse single-click no longer zooms (replaced by double-click, per user). +/−/Fit/keys zoom around the centre. Guard prevents iOS's synthetic dblclick from double-firing after a touch double-tap.
- Validation: 26 tests (new zoom.test.ts: pinch clamp/anchor, one-finger pan, double-tap timing/distance, mouse and post-pinch exclusions; viewer test updated for double-click toggle) and build pass. NOT verified on a real iPhone — pinch feel, Safari dblclick behaviour and `touch-action` interplay need device testing.

## Sync robustness fix (2026-10-17, PR #2)
- `library.merge` takes `lenient:true` from sync: invalid records / missing boards are skipped (`counts.skipped`), a card whose image is not downloadable is still saved. ZIP import stays strict/atomic.
- New `files.restore` action + `backfill()` in sync.ts: each sync fetches up to 40 missing images for non-deleted pins; only refs referenced by a pin and absent locally are written.
- Push: per-image upload failures no longer abort the push; failed refs are retried next run (`retry` list in localStorage sync state). Unknown blob types are uploaded as image/webp.

## Previous update — live sync backend (2026-10-16/17)
- Added a Studio Wall-specific Worker API (`worker/index.ts`, routed for `/api/*` via `run_worker_first`) backed by D1 (`records` table: owner, kind, id, updated_at, seq, data) and R2 (images keyed `email/file_ref`). Identity = Cloudflare Access JWT, verified in the Worker; fails closed (503/401) when bindings or Access vars are missing.
- Client `src/sync.ts`: push changed records + missing images, pull by sequence cursor, merge through `action('library.merge')` (newest updated_at wins; Inbox remap; `fromSync` merges don't re-trigger sync). Footer shows Saved on this device / Syncing… / Synced online. UI defers re-render while a dialog is open. Service worker no longer caches `/api/*`.
- D1 `studio-wall-sync` and R2 `studio-wall-files` created 2026-10-16 and bound in wrangler.jsonc. Access app (team frosty-block-644b, studio-wall.bobdylan2000.workers.dev, Owner policy) created by user 2026-10-17; vars set in wrangler.jsonc. Merged (PR #1) and deployed 2026-10-17 04:20 UTC, version 3fd835ac-f0ee-4bde-8bef-e29c6f9523c7, build log shows DB/FILES/Access vars bound; unauthenticated requests to site and /api redirect to Access login. PR preview builds fail instantly (non-production branch builds); production builds from main succeed. Real sign-in + desktop→phone sync not yet confirmed by the user. App requests persistent browser storage on boot. Steps in docs/SYNC_SETUP.md. Deploying without them is safe (app stays local).
- Deliberately separate from the shared studio platform (`studio-api` worker / `studio-db-prod`). Migration later = copy D1 records + R2 objects into the studio asset registry and point sync.ts at the studio API; local data shapes and client flow stay.
- Validation: 23 tests (new sync.test.ts with an in-memory fake server: two-device round trip incl. image, idempotent re-sync, 503 → stays local, record validation); build and `wrangler deploy --dry-run` pass. Not tested against real D1/R2/Access or on a phone.

## Previous update — whole-library backup / move devices (2026-10-16)
- New **Back up / move devices** dialog (sidebar foot on desktop; ⇄ button in the phone header). **Export everything** writes one ZIP with every board, reference, image blob and comment (including soft-deleted records so deletions carry). On touch devices with file-share support it opens the Share sheet (Files/AirDrop); otherwise it downloads. **Import backup or board** accepts the new library ZIP or the old single-board ZIP.
- Library import runs as one atomic `library.merge` action in data.ts (activity + outbox logged). Records keep their IDs; newer `updated_at` wins, so re-importing an updated backup adds/updates only what changed and never removes local items. Another device's Inbox merges into the local Inbox. Images are written only if the file_ref is missing locally. Missing image or invalid record aborts with no partial writes. Visibility is forced to private on import.
- IndexedDB name/version unchanged, so existing desktop data survives this update on the same hostname. A different hostname has separate storage; use Export everything → Import to move it.
- This is manual transfer, NOT live sync. Live cross-device sync needs the backend (identity + D1/R2 or the studio platform + authorized API). Not started; awaiting the user's decision on backend ownership and sign-in method.
- Validation: 20 tests (new backup.test.ts: round-trip to an empty device, Inbox merge, idempotent re-import, missing-image rollback) and production build pass. Real iPhone Share-sheet/Files import not verified.

## Previous update — single-click expanded image zoom (2026-10-03; superseded by double-click toggle 2026-10-17)
- Expanded gallery now shows the zoom-in magnifying-glass cursor at Fit. One click zooms to 200%; double-click is no longer required. Once zoomed, the grab cursor and drag-to-pan remain active; clicking or releasing a drag does not unexpectedly zoom back out. Fit / minus controls zoom out.
- Detail-view double-click to expand remains unchanged.
- Validation: all 18 tests and production build pass; gallery test covers single-click zoom and subsequent-click stability. Physical browser QA and Cloudflare rollout remain unverified.

## Previous update — mouse drag to pan (2026-10-03)
- Zoomed images support left-click, hold and drag to pan horizontally or vertically in both detail view and expanded gallery. Grab/grabbing cursors indicate the interaction.
- Shared pointer handler captures the mouse for dragging beyond image bounds and releases on pointer up/cancel/lost capture or returning to Fit. Native image dragging is suppressed while zoomed; touch scrolling/swipe behavior remains unchanged.
- Validation: 18 tests and production build pass. Tests exercise scroll deltas, capture cleanup, Fit state and ignoring touch/right-click. Physical mouse/mobile QA remains pending.

## Previous update — build stamp and double-click expand (2026-10-03)
- Footer now shows `vYYYY.MM.DD-HHmm` (UTC) and a human-readable build timestamp in America/New_York, labeled ET. Vite injects the timestamp once per build; reloading does not change it.
- Double-clicking the image in detail view opens the same expanded gallery as Expand gallery, starting with the current image. The handler includes the annotation wrapper.
- Validation: production build and existing 16-test suite pass. Physical mouse/iPhone QA and Cloudflare rollout verification remain pending.

## Previous update — Pinterest-style image navigation and comments (2026-10-03)
- Image detail toolbar: Back to board, Previous/Next with position indicator and arrow-key navigation, Comments shortcut, and owner-only board picker + Save a copy. Copies preserve credits and file references. Previous/Next asks before discarding edits.
- Image comments now appear above metadata editing, with a clear Post comment form. Cards show image comment counts. Board conversation is visible to the owner as well as in client preview.
- Collaborate includes an explicit Allow client comments checkbox (`Board.comments_enabled`). Existing boards retain their prior behavior. Turning off comments preserves history; view-only role always blocks client comments. Local preview comment actions check this setting and board/pin membership, and limit comments to 4,000 characters.
- These remain LOCAL PREVIEW features. No server, guest identity, live share URL, or cross-device comment delivery exists. `client_preview` is a UI/demo flag, not authorization. The shared API must derive identity and enforce board permissions server-side for all writes.
- Projects are not a separate entity in this repository. Project-wide comment policy and inherited per-board overrides remain for the shared backend integration; do not imply they have shipped.
- Validation: all 16 tests pass, including comment-off/view-only rejection and preservation, detail navigation and preview visibility. Production build passes. Fixed an existing typed-array inference build error in the PDF writer and updated the UI test for the existing Add chooser. No real-browser/mobile visual QA or Cloudflare deployment confirmation in this session.
- Next task: connect the agreed studio identity + board-sharing API, then wire this same comment experience to shared boards/projects. Confirm backend ownership/contract before building parallel infrastructure.

## Previous update — history, quick notes/links, and image markup (2026-10-02)
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
2. (Done 2026-10-18 via Apple Shortcut + /api/capture; see docs/SHARING_AND_CAPTURE.md.) Validate actual share-sheet receiving support on target browsers before implementing Web Share Target. iPhone support must not be assumed. Native camera picker and file import exist now.
3. Backend contract: studio identity, asset registry/file_ref, actor identity, API actions, outbox idempotency/revisions/conflicts, authorized image delivery. Do not send existing provisional events until migration semantics are settled.
4. (Mostly done 2026-10-18: revocable/expiring per-board links with view/comment, stars, comments, OG previews; password links and chosen-card links 2026-10-21. Remaining: invite-only links, client contributions, owner favourites review view.) Client access: owner-selected full board or a curated subset (scope pins and media, never the whole collection); client stars, pin notes and an owner review of favorites. Revocable/expiring board links, server-enforced view/comment/contribute roles, guest identity, optional login. Comments and contributions must be scoped by board. Do not treat the preview UI as access control.
5. Connect AI through the same authorized action endpoint. Never give an assistant direct database/bucket access.
6. (Done 2026-10-18: colour-word search, atomic single-board ZIP import, all-or-nothing multi-image upload via `pin.save_batch`.) Soft-deleted blobs currently retained for future sync; design tombstone retention and cleanup.

## Useful commands
npm ci; npm test; npm run build; npm run dev.
Cloudflare deployment later: npm run build then npx wrangler deploy (requires user's account setup).

## Data caveats
Local data may be evicted by the browser; export backups. URL saves retain URL only, not fetched remote image bytes. Shared-link visibility cannot be activated by local actions. Every device has independent data until backend integration. Source spec artifact was unavailable; data shapes follow the brief, not a verified shared SDK schema.

## Sharing contract to implement later
Public: anyone with the link, potentially forwarded. Private: invited, verified identities (not merely an unlisted URL). Password-protected: server-side password hashing, protected sessions and rate limiting; protect media URLs too. Access mode and collaborator role are independent. Add revoke/expiry, audit events and board-scoped contribution endpoints. AI must use these same authorized actions. Existing visibility stays private while share_settings holds local demonstration preferences.

## Repository and preview histories
GitHub and private Site source mirrors may have different commit SHAs for the same tree because GitHub connector pushes use Git objects. Fetch main before new work and compare trees rather than assuming matching commit IDs. Use fast-forward updates; never force-push over remote changes.
