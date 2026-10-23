# Client links, iPhone capture and deleted-image cleanup

The site is behind Cloudflare Access (your email login). Client links and the iPhone Shortcut each need one Access setting, made in the Cloudflare dashboard. Neither needs a password stored in the app or this repo.

## 1. Client share links

**How it works.** In a board, tap **Collaborate → Create client link**. Choose *View, star and comment*, *View, comment and add cards* (clients can add an image, link or note; labelled with their name; up to 25 per client per day; a client can remove cards they added from the same browser, and you find those in Recently deleted for 30 days) or *View only*, and when the link expires (7, 30 or 90 days, or never). The link (`/s/<random token>`) opens that one board only: its live images, titles and credits. Image notes, tags, markup, deleted cards and other boards are never sent. Hidden photo data (GPS location, camera, dates) is removed from images before clients see them. Links can be turned off at any time from the same dialog, and turning off **Allow client comments** makes every link of that board view only. Client stars and comments appear in your app, with the client's name, through sync. Link previews in iMessage, email and social apps show the board name and cover image.

Anyone holding an active link can open it, and it can be forwarded, so use an expiry date and turn links off when a project ends.

**Only some cards.** In a board, tap **Select**, choose the cards, then **Share selected**. That link shows only those cards, their images and the comments on them (plus comments on the whole board). Your other cards stay private. A chosen card you delete or move to another board drops out of the link. The link list says how many cards each such link holds.

**Password (optional).** Type a password (at least 8 characters) when creating the link, and send it to the client separately, for example by text. The client types it once per device; the browser then stays unlocked for 30 days or until the link expires. Ten wrong tries lock that connection out for 15 minutes. The password is stored only as a one-way hash, so it can't be shown again; to change it, turn the link off and create a new one. A password link's preview in iMessage or email shows only "Studio Wall", not the board name or cover image. Invitations for specific people (by email) are not built yet.

**One-time Cloudflare step (required before links open for clients):**
1. Zero Trust → Access controls → Applications → **Create new application** → Self-hosted. Name it "Studio Wall client links".
2. Add three public hostnames, all with subdomain `studio-wall` and domain `bobdylan2000.workers.dev`, and these paths:
   - `s/*`
   - `api/s/*`
   - `assets/*` (the page's code and styles; contains no data)
3. Policy: **Action: Bypass**, Include: **Everyone**. Save.

Access always applies the most specific path, so only these paths skip login. The rest of Studio Wall, including your API and images, still requires your email login. Test it: open a client link in a private window. It should open without asking you to log in.

## 2. Save from Safari's Share button (iPhone Shortcut)

**One-time Cloudflare step:**
1. Zero Trust → Access controls → **Service credentials** → Service Tokens → **Create service token**. Name it "Studio Wall Shortcut", duration non-expiring (or a year). Copy the **Client ID** and **Client Secret**. The secret is shown only once. Keep it only in the Shortcut, never in notes, email or this repo.
2. Applications → open the Studio Wall application (destination `studio-wall.bobdylan2000.workers.dev`) → Policies → **Create new policy**: Action **Service Auth**, Include → **Service Token** → "Studio Wall Shortcut". Save the application.

**Build the Shortcut** (Shortcuts app → +):
1. Tap the ⓘ (or the settings icon) and turn on **Show in Share Sheet**. Accept **Images**, **Safari web pages** and **URLs**.
2. Add **Get Images from** *Shortcut Input*.
3. Add **If** *Images* **has any value**:
   - **Repeat with each** item in *Images*:
     - **Convert** *Repeat Item* to **JPEG**. (iPhone photos are HEIC, which not every browser can show.)
     - **Resize** *Converted Image* to width **2400** (height automatic).
     - **Get Contents of URL**: `https://studio-wall.bobdylan2000.workers.dev/api/capture`, Method **POST**. Headers: `CF-Access-Client-Id` = your Client ID, `CF-Access-Client-Secret` = your Client Secret. Request Body: **File** → *Resized Image*.
4. **Otherwise**:
   - **Get URLs from** *Shortcut Input*.
   - **Get Contents of URL**: same URL, method and headers. Request Body: **JSON** with key `url` = *URLs* (optionally `title` = *Name* of Shortcut Input, `note` = text).
   - If more than one link comes through (a list, or several lines), the first one is saved.
   - Test it: in Safari open any page → Share → your Shortcut. The link appears as a card in the Inbox at the app's next sync. A notification with an error instead means the headers or the Service Auth policy need checking.
5. **End If**, then **Show Notification** "Saved to Studio Wall".

Everything lands in your **Inbox** and appears in the app at its next sync. To choose a board, add **Choose from Menu** (or **Ask for Input**) with the board name and append `?board=Board name` to the URL. An unknown name falls back to the Inbox. Optional query values: `title`, `credit`, `source` (the page link for an image).

The service token can only add to your library and list board names. It cannot read or change anything else.

## 3. Recently deleted and cleanup

- Deleted boards and references go to **Recently deleted** (desktop sidebar, or ⇄ on the phone) for **30 days**. You can restore them on any synced device. A restored reference whose board is gone returns to the Inbox. A restored board brings back the references deleted with it.
- After 30 days, image files are removed: on each device when the app opens, and in Cloudflare R2 at most once a day (triggered by sync). An image is never removed while any other reference, such as a copy on another board, still uses it, or while one was deleted less than 30 days ago.
- The small text records of deleted items stay, so every device agrees they were deleted.
