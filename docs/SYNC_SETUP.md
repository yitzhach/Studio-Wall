# Turning on live sync

Code is in `worker/index.ts` (API) and `src/sync.ts` (client). Until the steps below are done, `/api/*` answers 503 and the app stays device-local — deploying without them is safe.

1. **D1 database** — Cloudflare dashboard → Storage & Databases → D1 → Create → name `studio-wall-sync`. Copy its Database ID. (Tables are created automatically on first request.)
2. **R2 bucket** — R2 Object Storage → Create bucket → `studio-wall-files`. Keep it private (no public access, no custom domain).
3. **Sign-in (Cloudflare Access)** — Zero Trust → Access → Applications → Add → Self-hosted. Domain: the hostname Studio Wall is served on (whole site). Policy: Allow → Include → Emails → your email (one-time PIN login is fine). After saving, copy the **Application Audience (AUD) tag**; the team domain is under Zero Trust → Settings (e.g. `yourteam.cloudflareaccess.com`).
4. **Bind them** — add to `wrangler.jsonc` (the commented block there): `d1_databases` (DB), `r2_buckets` (FILES), and `vars` ACCESS_TEAM_DOMAIN / ACCESS_AUD. These IDs are not secrets, but never commit passwords or API tokens.
5. Deploy, open the site on desktop and sign in. The sidebar footer should read **Synced online**. Then open it on the phone, sign in with the same email, and your boards appear.

## How it works
- Every request is checked against the Access JWT (signature, issuer, audience, expiry). Records and images are stored per signed-in email.
- Each device keeps working offline from IndexedDB. It pushes records changed since its last push (and uploads any missing image to R2), then pulls everything newer than its cursor and merges it via `action('library.merge')` — newest `updated_at` wins, deletions travel as soft deletes, and each device's Inbox maps onto the local Inbox.
- Syncs on open, when the tab becomes visible, ~1.5 s after a local change, and every 20 s while visible.

## Known limits
- Last-writer-wins per record; simultaneous edits of the same card on two devices keep the later one. Device clocks are trusted for ordering.
- Server does not re-encode or strip metadata from uploads yet (client already normalizes to WebP ≤2400 px).
- The provisional outbox is still not sent; sync uses record state instead.
- Single owner per account email. Client sharing is not part of this.
