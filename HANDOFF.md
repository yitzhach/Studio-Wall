# Studio Wall handoff

Updated: 2026-10-29 (Stage 4). Start here in a new chat; no old conversation is needed. Updates from 2026-10-24 and earlier are in `docs/history.md`.

## Current state (2026-10-29) — read this first
- **Stage 4 of the backend move (2026-10-29): "Import my library to the studio"**, a button in Studio account (shown on studio sync). It sends every board, card, comment and picture on the device, Recently deleted included; a second run adds nothing. See "Latest update — Stage 4". **The user's next step: run it once on the device with the whole library, then check the counts on the other device** (Step 1, item 8). Next agent work: Stage 5 (client links), which needs the user's answers to decisions 6 and 8 first.
- **Code clean-up done (2026-10-28), no change in what the app does or how it looks:** PRs #30–#34, all merged and deployed. The owner app's code now lives in `src/app/` (see `docs/history.md`, "Previous update — clean-up"). Nothing new to try on devices from it.
- **Done 2026-10-26: Art-Talk-Back #43 merged** (docs + `studio-wall` CI job; "Deploy production API" run 163 green). Its red `show-tracker` check was art-show-tracker's e2e test removing a Playwright route while requests were in flight (that strands them in Chromium); fixed in art-show-tracker #17.
- **Stage 3 of the backend move (2026-10-26): studio sign-in and studio sync, built behind a per-device switch.** Old sync stays the default, so nothing changes until the user switches a device in **Studio account** (sidebar, or Back up / move devices → Studio account on a phone). See "Latest update". Shipping state is in "Latest update" → Shipped.
- **Backend move, stages 1–2 (2026-10-24), both in production:** Stage 1 (boards, cards and comments in studio-api) is Art-Talk-Back #42, deployed by "Deploy production API" run 155 with migration 0008. Stage 2 (this repo: `API` service binding → `studio-api`, `/v1/*` forwarded) is #25. Nothing changes for the user yet: the app still syncs through `/api/sync`. See "Latest update".
- **Merging:** the user allows the agent to merge its own PRs once tests and build pass (2026-10-22). Main deploys automatically.
- **Shipped 2026-10-22/23, not yet tried by the user:** owner "Client picks" review (PR #13) and client contributions through links (PR #14). Both live: checked 2026-10-23 via the Cloudflare connector — the deployed `studio-wall` Worker's `worker/index.ts` and `worker/strip.ts` are byte-identical to main after the PR #14 merge (contain `contributor_name`, `ADD_PER_GUEST`).
- **Deployed 2026-10-23:** PRs #15 (share page layout, 16 px fields on touch screens) and #16 (clients remove their own added cards). Workers Builds for both main merges succeeded (13:24 and 13:28 UTC); the deployed Worker source is byte-identical to main at 784acb8 (contains "You can only remove cards you added").
- **Deployed 2026-10-23 (later):** PRs #19 (owner told when a client removes a card), #20 (clients add up to 10 images at once) and #21 (Shortcut: first link kept). Checked via the Cloudflare connector after the #21 merge (main 6069923): the deployed `studio-wall` Worker contains `deleted_by`, `ADD_BATCH` and "the first link is kept". Device tests and decisions were not supplied this round (prompt placeholders left empty).
- **To try on devices (user):** (1) iPhone Safari, client link with *add cards*: open "+ Add to this board", tap each field — the page should not zoom in; add a photo from the library and from the camera, a link, a note; then Remove one of your cards and check it lands in the owner app's Recently deleted after sync and restores. (2) Same link on a desktop browser: the Conversation section is one column. (3) Owner app on iPhone: tapping search or a dialog field should no longer zoom. (4) Older open items: plain/password/chosen-card links in a private window, sync between phone and desktop, HEIC upload on desktop Chrome.
- **Live:** https://studio-wall.bobdylan2000.workers.dev (Cloudflare Worker `studio-wall`, deploys automatically from `main` via Workers Builds: `npm run build` then `npx wrangler deploy`). Whole site is behind Cloudflare Access (team `frosty-block-644b`, Owner policy = user's email, one-time PIN). PR preview builds fail instantly on non-production branches; production builds from main succeed — ignore preview failures, verify via the main build log.
- **Storage:** each browser keeps a full local copy in IndexedDB (works offline). With sync on, boards/cards/comments are also stored in D1 `studio-wall-sync` and image files in private R2 bucket `studio-wall-files` (key `email/file_ref`). So images live both locally and in Cloudflare.
- **Sync status:** PR #2 merged and deployed 2026-10-18; D1 shows pin updates arriving after the merge (seq 90, 2026-10-18 01:43 UTC). First live run (2026-10-17) — desktop uploaded 5 boards/~50 images, phone uploaded its own Inbox (7 images) + "Art Ideas", but the phone did not show desktop boards: one missing/undownloadable image aborted the whole strict merge. Fixed in PR #2 (lenient sync merge, image backfill, upload retry). **Still to confirm by the user: desktop boards + images now appear on the phone and phone items reach desktop.**
- **Deployed 2026-10-21/22:** PRs #7 (photo metadata), #8 (password links), #9 (chosen-card links) are live: the deployed Worker code contains `stripMetadata`, `sw_link`, `share_sessions` and `pin_ids` (checked 2026-10-22 via the Cloudflare connector). Workers Builds was slow and posted no check on these PRs, so verify by the deployed code, not GitHub checks. Not yet tried by the user on a device.
- **Access steps done 2026-10-22:** user created Access app "Studio Wall client links" (paths `s/*`, `api/s/*`, `assets/*` on studio-wall.bobdylan2000.workers.dev; policy "Clients" = Bypass/Everyone) and a service token "Studio Wall Shortcut" with a Service Auth policy "Shortcut" on the main app ("bobdylan2000.workers.dev"). Checked from outside without login: `/s/<token>` 200, `/api/s/<unknown 32-char token>/board` 404 "no longer active" (reaches the Worker), `/assets/*` 200; `/`, `/api/boards`, `/api/capture` still redirect to Access login. The reusable "Shortcut" policy was first created but not attached to the main app (app_count 0), so the Shortcut got the Access login page (empty notification, nothing in D1); the agent attached it via the Cloudflare API connector (main app policies now Owner 1, Shortcut 2). Service token itself not testable by the agent (secret stays with the user).
- **iPhone Shortcut works (2026-10-22):** built per docs/SHARING_AND_CAPTURE.md §2 (photos-only version: Receive Images from Share Sheet → Convert to JPEG → Resize 2400 → Get Contents of URL POST /api/capture with the two CF-Access-Client-* headers, body File = Resized Image → Show Notification). First capture landed in D1 (pin created_by `shortcut`, with image, 16:41 UTC). iOS asks once to allow sending photos to the site ("Always Allow"). Not yet added: the link (Safari URL) branch.
- **Connectors:** the session now has the Cloudflare API connector (mcp.cloudflare.com, Access read/edit), so Access apps/policies can be checked and changed by the agent; the older Workers-bindings connector still serves D1 queries.
- **Next steps:** the user runs the import and checks the counts; then Stage 5 (client links on the platform). See "What happens next" and the prompt for a new chat.

## What happens next (2026-10-29)
The backend + AI work follows **docs/backend-and-ai-plan.md**. Stages 1–4 are done (Stage 4 on 2026-10-29); Stage 5 is next. Order:

**Step 1 — the user tests on devices (no agent needed).** Report what works and what doesn't (a screenshot helps).
1. iPhone Safari, a client link with *View, comment and add cards*: open "+ Add to this board" and tap each field (the page should not zoom); add a photo from the library, one from the camera, a link and a note; Remove one of your added cards; in the owner app after sync, find it in Recently deleted and restore it.
2. The same client link on a desktop browser: Conversation section in one column, add panel looks right.
3. Owner app on iPhone: tapping search or a dialog field should not zoom.
4. New (2026-10-23): on the client link, choose **several photos at once** (iPhone Photos picker: tap more than one) — all should appear, each "Added by <name>". Then Remove one as the client: within ~20 s the owner app shows "<name> removed a card from <board> · see Recently deleted", the board shows a notice with a Recently deleted button, and Restore brings it back.
5. iPhone Shortcut: add the link branch (docs/SHARING_AND_CAPTURE.md §2 step 4), then share a Safari page to it; the link should land in the Inbox.
6. Older open checks: plain, password and chosen-card links in a private window; phone ↔ desktop sync (desktop boards and images on the phone, phone captures on desktop); HEIC upload in desktop Chrome; "Client picks" with a real client star.
7. New (2026-10-26), Studio account, when convenient: on the iPhone open Back up / move devices → Studio account, sign in with the emailed code (or your password), and leave it on **Old sync**: nothing should change. Optional, on a second device too: switch both to **Studio sync**, make a new board with a photo and a note on one, and check it appears on the other within about 20 seconds; edit it on the other and check it comes back. Boards from before the switch stay on each device until Stage 4's import. Switch back to Old sync any time (it reloads; nothing is deleted). Client links need Old sync until Stage 5.
8. New (2026-10-29), **the import**: on the device with the whole library (the desktop, per the plan), Studio account → sign in → **Studio sync** (it reloads) → Studio account → **Import my library to the studio**. Keep Studio Wall open until the line under the button starts with "Done." and says e.g. "In the studio: 8 of 8 boards, 67 of 67 cards, 4 of 4 comments". Then on the phone: sign in, switch to Studio sync, wait for "Studio · synced", and check the boards, a few pictures, the comments, and Recently deleted (same items, thumbnails show; Restore one and see it come back on the desktop). Press the import once more on the desktop: the numbers stay the same. Client links still need Old sync, so switch a device back if a client needs one before Stage 5.

**Step 2 — decisions.**
Answered 2026-10-24 ("yes to all", the plan's recommendations):
1. Move Studio Wall's data onto `studio-api`: **yes**.
2. Owner sign-in with the studio's email code / password inside the app, Cloudflare Access kept in front during the move: **yes**.
3. Client links rebuilt in studio-api at the same `/s/<token>` address: **yes**.
4. Old D1 `studio-wall-sync` and R2 `studio-wall-files` kept read-only for 30 days after the switch, then the user decides about deleting them: **yes**.
5. Automatic subject/mood tags: **not now**, as recommended. "Yes to all" was read as accepting the recommendations; this costs money, so ask again before building it.

Still open (the agent asks, never builds on a guess):
6. Client cards: keep adding straight onto the board (current), or have the owner approve them first?
7. Cloudflare Images (costs money): yes / not now?
8. Email invitations for client links (email service + API key): yes / not now?
9. Owner app search field's second inner border: keep or remove?

**Step 3 — agent work.**
1. Fix anything Step 1 finds.
2. **Done 2026-10-24: Stages 1 and 2** (see "Latest update"): both merged and in production.
3. **Done 2026-10-26: Stage 3** (see "Latest update").
4. **Done 2026-10-29: Stage 4**, "Import my library to the studio" (see "Latest update — Stage 4").
   **Next: Stage 5, client links on the platform** (docs/backend-and-ai-plan.md §4): `shares`, guest sessions, password hashing, rate limits, chosen cards, contributions with daily limits, multi-image adds, remove-own-card, `deleted_by`, link previews, in studio-api (Art-Talk-Back, a numbered migration); the `/s/<token>` page stays here and calls studio-api through the `API` binding. Gate: `src/contribute.test.ts` and `src/share-password.test.ts` ported to studio-api tests, plus a Chromium check of the client page.
   **What Stage 5 needs from the user:** (a) decision 6 — client cards: straight onto the board (as now) or approved by you first; (b) decision 8 — email invitations: not now (recommended, no cost) or yes (needs an email service and its API key, a secret, possibly paid); (c) decision 7 (Cloudflare Images) doesn't block it: "not now" keeps today's pictures. (d) Run the Stage 4 import first, so the boards a link points at are in the studio. Nothing else: no new Worker (the page stays on `studio-wall`), and no live client links exist, so nothing has to move.
5. *(Stage 3 as planned, kept for reference)*
   - a "Studio account" panel (email code or password, from inside the app on this origin, as Booth Studio does);
   - an adapter from local actions to studio-api ops (the mapping is in "Latest update"), pull into `library.merge`, review cards on conflicts;
   - a setting that picks old sync or studio sync per device, so nothing changes until the user switches;
   - gate: a two-device test against a local studio-api from an Art-Talk-Back checkout (like booth-studio `tests/two-devices.mjs`), headless Chromium at 390 px and desktop, plus a CI check that `src/vendor/studio-sdk.js` matches the platform's `bundle:esm`.

   **What Stage 3 needs from the user:** nothing required. The studio account already exists: the user's email is studio-api's owner, and the emailed code or the password signs in. Optional: a staging Worker `studio-studio-wall-staging` bound to `studio-api-staging`, for trying studio sync without touching the live app. Its first deploy is the user's step, and the plan's gate doesn't need it. Decisions 6–9 above don't block Stage 3.
3. Done in the 2026-10-23 round: owner told of client removals (#19), multi-image client adds (#20), Shortcut first-link fix (#21).

**Start a new chat?** Yes, for Stage 5. Attach yitzhach/Studio-Wall and yitzhach/Art-Talk-Back to the chat, fill in the lines in angle brackets, and paste this prompt (written 2026-10-29):

```
Stage 5 of the Studio Wall backend move: client links on the platform.

Repos: yitzhach/Studio-Wall (default branch main; merging deploys to
Cloudflare) and yitzhach/Art-Talk-Back (default branch
claude/next-steps-y4vrwv). Work from each repo's current default branch.

Read first:
- Studio-Wall: HANDOFF.md ("Current state", "What happens next",
  "Latest update — Stage 4"), AGENTS.md, docs/backend-and-ai-plan.md.
  Client links today: worker/ and src/share.ts.
- Art-Talk-Back: CLAUDE.md, docs/HANDOFF.md, docs/phase-5-studio-wall.md,
  docs/SHIPPING.md.

Device test results: <what worked / what didn't, or "not tested yet">
Import: <ran on desktop/phone; counts on the other device matched / didn't>
Decision 6, client cards: <straight onto the board / I approve them first>
Decision 8, email invitations: <not now / yes>

This round:
1. Fix anything my device tests or the import found.
2. Build Stage 5: client links in studio-api, the /s/<token> page in
   Studio-Wall calling it through the API binding. Gate: the ported
   contribute and share-password tests pass in studio-api, plus a
   Chromium check of the client page.
3. Before merging Studio-Wall: npm run format:check, npm test,
   npm run build, and npm run test:devices. In the cloud sandbox, run
   pnpm install in an Art-Talk-Back checkout first, then:
   STUDIO_PLATFORM=../Art-Talk-Back STUDIO_WALL_CHROMIUM=/opt/pw-browsers/chromium npm run test:devices
4. Merge your own PRs once CI is green, app before platform as
   docs/SHIPPING.md says. The "Workers Builds" preview check always
   fails on Studio-Wall PR branches; ignore it. Check each Studio-Wall
   deploy with the Cloudflare API connector (the Workers Builds build
   for the merge commit on main must say success).
5. Keep Studio-Wall's HANDOFF.md current, and Art-Talk-Back's
   docs/HANDOFF.md, DECISIONS.md and CHANGELOG.md.
6. Stop after Stage 5. Tell me what Stage 6 (switch over) needs from me.

Ask me before anything that changes how the app or the client page
looks, needs my decision, costs money, needs secrets, is a new Worker's
first deploy, or deletes data. At the end, list what to try on my
devices.
```

## Latest update — Stage 4: import my library to the studio (2026-10-29)
- Device tests: none supplied this round (the prompt's placeholders were left empty), so there was nothing to fix. Which device has the whole library wasn't said either; the plan says the desktop, and the steps above work from either.
- **The button:** Studio account → "Import my library to the studio", shown only while the device is on Studio sync. It sends every board, card, comment and picture on this device, Recently deleted included, then says how much of it the studio has: "Done. In the studio: 8 of 8 boards, 67 of 67 cards, 4 of 4 comments (Recently deleted included)." If anything is still on its way it says so ("run it again, or leave Studio Wall open"). The Studio sync line in the panel now says older boards wait "until you import them". Nothing else in the app changed.
- **How (src/studio.ts):** the import sets `all` in the sync state (localStorage `studio-wall-studio-sync`), and `plan()` then takes every record into scope, not just the ones made since switching. Records keep their ids, so a second run (or a second device running it) finds them already there and sends nothing.
  - **Recently deleted:** a deleted record the studio never had goes up live first (`later`), gets its picture, and is deleted in the studio once complete. A deleted board waits for its deleted cards, then one delete takes them all (so restoring the board brings them back, as on the device). A deleted card whose picture isn't on this device goes without it.
  - **The other device** gets records deleted before it ever had them into its Recently deleted (30 days, as on the device): pulls keep the deleted record until the plan has used it once. Pictures of deleted cards now download too, so thumbnails show there.
  - **The same library on both devices** (copied by old sync, same ids): the first time they meet, the newer copy wins, quietly; no review cards for the whole library. Review cards stay for records both devices changed after they agreed.
  - **Board covers** wait until their card is in the studio (the studio refuses a cover it doesn't have), then follow as an update.
  - A create now records what it sent as the agreed state, so an edit made before the studio answers goes as an update instead of looking like news from the studio.
  - The sync cycle allows 10 rounds (was 4): records, then pictures, then each card's picture, then the deletes.
- **Tests:** `src/studio.test.ts` 20 (7 new: older records once and a second run sends nothing, cover waits for its card, a deleted card with its picture, a deleted board with its cards, a card without its picture, no import → older deleted records stay, the other device's Recently deleted, first meeting newer wins). `tests/two-devices.mjs` 54 checks (18 new): the desktop builds an older library before sign-in (a board with an idea, a picture and a comment; a deleted picture; a deleted board with two cards), imports it; the studio's counts (live and deleted, read from `/v1/sync/pull`) equal the desktop's; a second run adds nothing; the phone's IndexedDB counts equal the desktop's; the older picture opens; the comment is there; Recently deleted has the deleted picture (thumbnail opens) and board; restoring both on the phone brings them back on the desktop with both cards and the picture. `npm test` 85, format, build, `npm run test:devices` 54/54 in the cloud sandbox.
- **Art-Talk-Back:** unchanged; studio-api already had everything the import needs.
- **Shipped:** see "Current state" (filled in after the merge).

## Latest update — Stage 3: studio sign-in and studio sync (2026-10-26)
- Device tests: none this round ("not tested yet"), so there was nothing to fix.
- **Studio account** (sidebar button; on a phone: Back up / move devices → Studio account): the studio's emailed code or password, set/change/remove password, sign out. Signing in alone changes nothing.
- **How this device syncs:** Old sync (default, `/api/sync` as before) or Studio sync. Switching reloads the page, so only one of them runs. On Studio sync the share dialog says client links need Old sync (they live on the old Worker until Stage 5).
- **Studio sync** (`src/studio.ts`, loaded only when signed in; `src/studio-session.ts` is the tiny always-loaded part):
  - `plan()` compares every local record with the SDK's copy against the last agreed state (a hash per record, kept in localStorage `studio-wall-studio-sync`). Only this device moved → create / update (changed fields only) / delete / restore. Only the studio moved → `library.merge` with `studio: true` (skips newer-wins). Both moved → the studio's copy wins and a review card in Studio account offers "Use this device’s version". The server's own conflicts (two offline edits) make the same card. Art-Talk-Back D-087.
  - What goes up: what the studio already has, what's made on this device after switching, the Inbox, and what those need (a new card's board). Older boards wait for Stage 4's import (D-088). Each device's Inbox maps onto the studio's Inbox.
  - Deletes go last; cards deleted with their board go with the board's delete/restore. Refused creates/restores stay local, listed under "Not in the studio" in the panel, until changed (e.g. restoring a card whose board is deleted in the studio: "Restore its board first").
  - Pictures: uploaded once the card is on the server (`/v1/files/upload-url`, PUT, `attach` to the pin), then `fileId` is set; other devices fetch by signed link into IndexedDB.
  - Syncs on a local change (1 s later), on focus, visibility and reconnect, and every 20 s. Status in the sidebar footer and the phone header button: "Studio · synced / syncing… / offline · N changes waiting / sign in again / N cards to review".
  - A sign-in the studio ends keeps the device's waiting changes; signing in again as the same person sends them. Sign-out deletes only the studio's copy on this device (IndexedDB `studio-wall.studio`), never the boards.
- **Offline service worker:** `/v1/*` is never cached (scripts/sw.mjs), like `/api/*`; it would otherwise have replayed old sync pulls and sign-in answers offline. The two-device run keeps the service worker on.
- **Tests:** `src/studio.test.ts` (13: mapping, scope, Inbox, conflicts, deletes and restores, refusals). `tests/two-devices.mjs` (`npm run test:devices`, 36 checks): the built app + its Worker + the real studio-api under `wrangler dev` from an Art-Talk-Back checkout; desktop and a 390 px phone; signed out → no `/v1` and no studio chunk; sign-in; switch; board + idea + picture + comment up; phone gets them (picture opens), shares the Inbox, no sideways scroll; edits both ways; offline edit and new card after reconnect; conflict and review card; board delete and restore with its cards; sign-out keeps the boards. `SHOTS=<dir>` saves panel screenshots.
- **CI (new):** `.github/workflows/ci.yml`, job `check`: `npm test`, build, `src/vendor/studio-sdk.js` against the platform's `bundle:esm --check`, then the two-device run with the network cut (like booth-studio). Art-Talk-Back got a matching `studio-wall` job. `playwright` 1.56.1 is a dev dependency.
- **Shipped 2026-10-26:** PR #27 merged (`c52854f`). Workers Builds on main succeeded (build `f79ba18d`). The live site's `main-BGIpcUyD.js` has the Studio account button and its `studio-CVpRMSjl.js` chunk has the studio sync code (checked by fetching the deployed assets). The PR's own preview builds failed as they always do here (no `previews` block). Platform side: Art-Talk-Back #43 (docs, D-087…D-089, `studio-wall` CI job) is open; its `show-tracker` check failed 3 times in the pull-request run (it passed in the push run and locally); see the open item at the top of "Current state".

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
3. (Planned and approved 2026-10-24: docs/backend-and-ai-plan.md.) Backend contract: studio identity, asset registry/file_ref, actor identity, API actions, outbox idempotency/revisions/conflicts, authorized image delivery. Do not send existing provisional events until migration semantics are settled.
4. (Mostly done 2026-10-18: revocable/expiring per-board links with view/comment, stars, comments, OG previews; password links and chosen-card links 2026-10-21. Remaining: invite-only links. Owner favourites review done 2026-10-22; client contributions 2026-10-23, clients removing their own added cards 2026-10-23.) Client access: owner-selected full board or a curated subset (scope pins and media, never the whole collection); client stars, pin notes and an owner review of favorites. Revocable/expiring board links, server-enforced view/comment/contribute roles, guest identity, optional login. Comments and contributions must be scoped by board. Do not treat the preview UI as access control.
5. (Planned 2026-10-24 in docs/backend-and-ai-plan.md, stage 7.) Connect AI through the same authorized action endpoint. Never give an assistant direct database/bucket access.
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
