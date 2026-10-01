# Studio Wall

Dark-first, device-local inspiration boards for artists, with a matching light theme and client mood-board preview.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
```

Deploy `dist/` to static hosting over HTTPS. For Cloudflare Workers Static Assets, use the included `wrangler.jsonc` when you are ready to connect your own Cloudflare account. No backend, keys, or database binding is required for this prototype. The `.openai/hosting.json` identifies the separate private review deployment; GitHub remains the working code handoff.

## Working now

- Responsive inspiration grid, Inbox, boards and pin focus view; dark/light preference.
- Multiple photo uploads, drag/drop, paste images or URLs, browser camera picker, text ideas and URL bookmarks.
- Device-side colour palette extraction; notes, tags, source credit and ownership fields.
- Board create/rename/reorder/soft delete, cover selection, pin editing/moving/soft delete.
- IndexedDB blobs and records, ULIDs, action/activity/outbox boundary.
- Search title/note/tag/credit/palette hex, ZIP board export/import with remapped IDs.
- Offline shell and installable manifest. Browser storage remains subject to eviction; export important boards.
- Client view preview and local board comments. Real sharing is intentionally unavailable.

## Boundaries

The app saves on one browser/device. It does not sync. A URL is a bookmark, not a remote image downloader. All palette extraction needs a browser-decodable image. HEIC support depends on browser decoding. No Web Share Target receiver is shipped; validate iPhone and Android support before adding it. Test installation, camera permissions and offline reopening on real devices. A mocked DOM integration test is not real browser/phone QA.

`src/data.ts` is the local repository boundary. `action()` commits domain state, file blobs, activity, and outbox in one IndexedDB transaction. Studio/actor identity is local-only and not authentication. The outbox is a future integration seam, NOT a finalized sync contract. Keep shared asset identifiers opaque and server-authorize board access. See `docs/plan.md` and `HANDOFF.md`.

## Sample image

`public/sample-plaster.webp` was generated for this prototype; it is labeled AI-generated when added. Prompt: a standalone vertical photographic material study of weathered pale turquoise lime plaster over warm ochre/copper strata, no interface or text. The optional sample board is loaded only when selected.
