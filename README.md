# Studio Wall

Dark-first inspiration boards for artists, with a matching light theme. Every device keeps a full copy of the library, syncs with the artist's other devices, and can share boards with clients through links.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
npm run format          # Prettier; CI fails on unformatted code
npm run test:devices    # two devices against a local studio-api (needs an Art-Talk-Back checkout; see the script)
```

Live at https://studio-wall.bobdylan2000.workers.dev, behind Cloudflare Access: the Worker `studio-wall` (`worker/index.ts`, `wrangler.jsonc`) serves `dist/`, old sync and client links. Pushing to `main` deploys it (Workers Builds). See `HANDOFF.md` for the current state. `.openai/hosting.json` identifies the separate private review deployment; GitHub remains the working code handoff.

## Working now

- Responsive inspiration grid, Inbox, boards and pin focus view; dark/light preference.
- Multiple photo uploads, drag/drop, paste images or URLs, browser camera picker, text ideas and URL bookmarks.
- Device-side colour palette extraction; notes, tags, source credit and ownership fields.
- Board create/rename/reorder/soft delete, cover selection, pin editing/moving/soft delete.
- IndexedDB blobs and records, ULIDs, action/activity/outbox boundary.
- Search title/note/tag/credit/palette hex, ZIP board export/import with remapped IDs.
- Offline shell and installable manifest. Browser storage remains subject to eviction; export important boards.
- Mouse selection boxes from grid whitespace, optional Select-mode circles, Cmd/Ctrl-click toggles, Shift-click ranges and atomic bulk copy/move; desktop group drag/drop onto boards.
- Detail zoom and a dark full-window image carousel with arrow navigation, touch swipe and optional native fullscreen.
- Present / PDF for the visible collection or selected references; print/save PDF and attach it to email. Image notes are excluded; text references and credits are included.
- Sync between the artist's devices: old sync through the Worker (`src/sync.ts`, D1 + R2), or studio sync through studio-api (`src/studio.ts`), chosen per device in Studio account.
- Client links (`/s/<token>`, `src/share.ts`): view, star, comment or add cards; optional password, expiry, chosen cards only. Client picks and client news in the owner app.
- Recently deleted (30 days), iPhone Shortcut capture (`docs/SHARING_AND_CAPTURE.md`), photo metadata stripped on the server.
- Local client preview of a board on this device.

## Boundaries

Each browser keeps its own full copy in IndexedDB; sync and client links need the Worker (and, for studio sync, studio-api from yitzhach/Art-Talk-Back). A URL is a bookmark, not a remote image downloader. All palette extraction needs a browser-decodable image. HEIC support depends on browser decoding. No Web Share Target receiver is shipped; validate iPhone and Android support before adding it. Test installation, camera permissions and offline reopening on real devices. A mocked DOM integration test is not real browser/phone QA.

`src/data.ts` is the local repository boundary: `action()` commits domain state, file blobs, activity and outbox in one IndexedDB transaction, one function per action type. The owner app is `src/main.ts` (wiring) and `src/app/` (state, rendering, dialogs, sync status). See `docs/backend-and-ai-plan.md` and `HANDOFF.md`.

## Sample image

`public/sample-plaster.webp` was generated for this prototype; it is labeled AI-generated when added. Prompt: a standalone vertical photographic material study of weathered pale turquoise lime plaster over warm ochre/copper strata, no interface or text. The optional sample board is loaded only when selected.

For a new session, read AGENTS.md and HANDOFF.md.
