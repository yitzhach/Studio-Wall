/* ==========================================================================
   The studio platform's gate for Studio Wall, stage 3 (docs/backend-and-ai-plan.md): two devices, one
   studio, in a real browser.

   Runs the built app (dist/) behind its real Worker (worker/index.ts) and the real studio-api together under
   `wrangler dev`, one origin as in production, against a fresh local D1 and R2, and drives two browser
   contexts ("devices", each with its own storage) through the real pages:

     signed out   nothing calls /v1 and the studio code never loads.
     sign-in      the studio's email code, from inside Studio Wall; nothing syncs until the device switches.
     switch       studio sync on: the Inbox and what's made from now on go up; an older board stays local.
     device 2     a phone (390 px) signs in and gets the board, its cards, the picture and the comment;
                  its own Inbox maps onto the studio's.
     edits        an edit on the phone reaches the desktop.
     offline      an edit and a new card made with no network reach the other device after a reconnect.
     conflict     the same card edited on two offline devices: the studio keeps the first, the second
                  device gets a review card and can put its own back.
     delete       a board deleted on one device goes on the other, and Recently deleted brings it back
                  with its cards.
     import       stage 4: "Import my library to the studio" on the desktop sends the older library, pictures
                  and Recently deleted included; the phone ends up with the same counts, the pictures open,
                  Recently deleted carries over and restores; a second run adds nothing.
     sign-out     signing out keeps everything on the device and goes back to old sync.

   The studio API lives in yitzhach/Art-Talk-Back. Point STUDIO_PLATFORM at a checkout of it with
   `pnpm install` done (default: ../Art-Talk-Back). The app's Worker runs from a temporary config bound to
   that checkout's dev API, so wrangler.jsonc stays production.

   Usage: npm run build && STUDIO_PLATFORM=../Art-Talk-Back node tests/two-devices.mjs
   ========================================================================== */
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(APP, process.env.STUDIO_PLATFORM || path.join("..", "Art-Talk-Back"));
const PORT = Number(process.env.E2E_PORT || 8793);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const EMAIL = "owner@example.com"; // OWNER_EMAILS in studio-api's dev config

const fails = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else fails.push(name + (detail ? ` — ${detail}` : ""));
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? `  — ${detail}` : ""));
}

/* ---- the server: app Worker + studio-api, fresh D1 ------------------------ */
/** JSON with comments and trailing commas (wrangler.jsonc) → a value. */
function readJsonc(file) {
  const src = fs.readFileSync(file, "utf8");
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
/** studio-api's own dev config, paths made absolute, with a throwaway SIGNING_KEY for file links (no secrets). */
function apiConfig(state) {
  const dir = path.join(ROOT, "workers", "studio-api");
  const c = readJsonc(path.join(dir, "wrangler.jsonc"));
  delete c.$schema;
  delete c.env;
  c.main = path.join(dir, c.main);
  c.vars = { ...c.vars, SIGNING_KEY: "studio-wall-two-devices-test-key-not-a-secret" };
  for (const d of c.d1_databases) d.migrations_dir = path.join(dir, d.migrations_dir);
  const file = path.join(state, "studio-api.wrangler.json");
  fs.writeFileSync(file, JSON.stringify(c));
  return file;
}
let log = "";
function startServer() {
  if (!fs.existsSync(path.join(APP, "dist", "index.html"))) throw new Error("No dist/: run `npm run build` first");
  if (!fs.existsSync(path.join(ROOT, "workers", "studio-api", "wrangler.jsonc")))
    throw new Error(`No studio platform at ${ROOT}: set STUDIO_PLATFORM to an Art-Talk-Back checkout`);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wall-e2e-"));
  const app = readJsonc(path.join(APP, "wrangler.jsonc"));
  // `wrangler dev` with several Workers takes every named export for an entrypoint; the Worker's helpers are
  // exported for the unit tests, so only its default export is re-exported here. The deployed Worker is unaffected.
  const entry = path.join(state, "entry.mjs");
  fs.writeFileSync(entry, `export { default } from ${JSON.stringify(path.join(APP, "worker", "index.ts"))};\n`);
  // No D1, R2 or Access here: old sync (/api/*) fails closed, as it does for anyone Access hasn't signed in.
  const appConfig = path.join(state, "app.wrangler.json");
  fs.writeFileSync(appConfig, JSON.stringify({
    name: "studio-wall-dev",
    main: entry,
    compatibility_date: app.compatibility_date,
    assets: { ...app.assets, directory: path.join(APP, "dist") },
    services: [{ binding: "API", service: "studio-api-dev" }],
  }));
  const wrangler = path.join(ROOT, "node_modules", ".bin", "wrangler");
  const env = { ...process.env, CI: "1" };
  const api = apiConfig(state);
  const mig = spawnSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "-c", api], { cwd: ROOT, encoding: "utf8", env });
  if (mig.status !== 0) throw new Error(`migrations failed: ${mig.stdout}${mig.stderr}`);
  const proc = spawn(wrangler, ["dev", "-c", appConfig, "-c", api, "--persist-to", state, "--port", String(PORT), "--ip", "127.0.0.1"], { cwd: ROOT, env });
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  return { proc, state };
}
async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${ORIGIN}/v1/openapi.json`)).ok && (await fetch(`${ORIGIN}/index.html`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not come up:\n${log.slice(-3000)}`);
}
async function codeFor(email, after) {
  const re = new RegExp(`sign-in code for ${email.replace(/[.@+]/g, "\\$&")}: (\\d{6})`, "g");
  for (let i = 0; i < 300; i++) {
    const all = [...log.slice(after).matchAll(re)];
    if (all.length) return all.at(-1)[1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no sign-in code in the dev log");
}

/** A small PNG (a warm gradient), for the image card. */
function png(w = 48, h = 32) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push(200 + (x % 50), 120 + y, 60, 255);
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(8 + data.length + 4);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

/* ---- devices ---------------------------------------------------------------- */
const launch = {
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  ...(process.env.STUDIO_WALL_CHROMIUM ? { executablePath: process.env.STUDIO_WALL_CHROMIUM } : {}),
};
const IGNORE = /Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|ERR_NETWORK_CHANGED/;
async function device(browser, name, viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on("dialog", (d) => d.accept()); // the app's "Delete this board?" confirms
  const errors = [];
  const v1 = [];
  const chunks = [];
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/v1/")) v1.push(u.pathname);
    if (/\/assets\/studio-/.test(u.pathname)) chunks.push(u.pathname);
  });
  return { name, ctx, page, errors, v1, chunks, phone: viewport.width < 600 };
}
async function ready(d) {
  await d.page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await d.page.waitForSelector(".topline h1");
}
const visible = (sel) => `${sel} >> visible=true`;
/** Wait for a condition in the page, nudging sync (the app syncs on focus) while it isn't true yet. */
async function until(d, fn, arg, what, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      await d.page.waitForFunction(fn, arg, { timeout: 2000 });
      check(`${d.name}: ${what}`, true);
      return true;
    } catch {
      if (Date.now() > end) {
        check(`${d.name}: ${what}`, false, `timed out; status “${await d.page.getAttribute("[data-action=library]", "title").catch(() => "?")}”`);
        return false;
      }
      await d.page.evaluate(() => dispatchEvent(new Event("focus"))).catch(() => {});
    }
  }
}
const statusIs = (d, text) => until(d, (t) => document.querySelector("[data-action=library]")?.title === t, text, `status “${text}”`);
const hasCard = (d, text, what) => until(d, (t) => [...document.querySelectorAll(".pin")].some((p) => p.textContent.includes(t)), text, what || `shows a card “${text}”`);
async function openStudio(d) {
  if (d.phone) {
    await d.page.click(visible(".mobile-brand [data-action=library]"));
    await d.page.click("#open-studio");
  } else await d.page.click(visible("[data-action=studio]"));
  await d.page.waitForSelector("#modal[open] .eyebrow:has-text('STUDIO ACCOUNT')");
}
/** SHOTS=<dir>: screenshots of the Studio account panel, to look at. */
const shot = (d, name) => process.env.SHOTS && d.page.screenshot({ path: path.join(process.env.SHOTS, `${d.name}-${name}.png`) });
async function signIn(d) {
  await openStudio(d);
  await shot(d, "sign-in");
  const mark = log.length;
  await d.page.fill("#st-email", EMAIL);
  await d.page.click("#st-send");
  await d.page.fill("#st-code", await codeFor(EMAIL, mark));
  await d.page.click("#st-verify");
  await d.page.waitForSelector("#st-signed-in");
  await shot(d, "signed-in");
}
async function switchToStudio(d) {
  await Promise.all([d.page.waitForEvent("load"), d.page.click("[name=st-mode][value=studio]")]);
  await d.page.waitForSelector(".topline h1");
}
async function openBoard(d, name) {
  await d.page.click(visible("[data-nav=boards]"));
  await d.page.click(`.board-card button:has-text("${name}")`);
  await d.page.waitForSelector(`.topline h1:has-text("${name}")`);
}
async function addIdea(d, title, note) {
  await d.page.click(visible(".header-actions [data-action=save]"));
  await d.page.click("[data-kind=idea]");
  await d.page.fill("#save-form [name=title]", title);
  await d.page.fill("#save-form [name=note]", note);
  await d.page.click("#save-form .submit");
  await d.page.waitForFunction(() => !document.querySelector("#modal")?.open);
}
async function editNote(d, cardText, note) {
  await d.page.click(`.pin:has-text("${cardText}")`);
  await d.page.fill("#edit-form [name=note]", note);
  await d.page.click("#edit-form .submit");
  await d.page.waitForFunction(() => !document.querySelector("#modal")?.open);
}
async function addPicture(d, title) {
  await d.page.click(visible(".header-actions [data-action=save]"));
  await d.page.click("[data-kind=image]");
  await d.page.setInputFiles("#upload", { name: "gradient.png", mimeType: "image/png", buffer: png() });
  await d.page.fill("#save-form [name=title]", title);
  await d.page.click("#save-form .submit");
  await d.page.waitForFunction(() => !document.querySelector("#modal")?.open);
}
async function newBoard(d, name) {
  await d.page.click(visible("[data-action=new-board]"));
  await d.page.fill("#modal [name=name]", name);
  await d.page.click("#modal .submit");
  await d.page.waitForSelector(`.topline h1:has-text("${name}")`);
}
async function deleteBoard(d) {
  await d.page.click(visible("[data-action=board-menu]"));
  await d.page.click("#delete-board");
  await d.page.waitForFunction(() => !document.querySelector("#modal")?.open);
}
async function openTrash(d) {
  if (d.phone) {
    await d.page.click(visible(".mobile-brand [data-action=library]"));
    await d.page.click("#open-trash");
  } else await d.page.click(visible("[data-action=trash]"));
  await d.page.waitForSelector("#modal[open] .trash-list, #modal[open] .hint");
}
/** The studio's own records, read through the signed-in device's session (what's really in studio-api). */
const studioList = (d, p) => d.page.evaluate(async (p) => (await (await fetch(p)).json()), p);
/** Everything the studio holds, deleted included, per type: {live, deleted}. */
const studioCounts = (d) =>
  d.page.evaluate(async () => {
    const seen = {};
    for (let since = "0"; ; ) {
      const page = await (await fetch(`/v1/sync/pull?since=${encodeURIComponent(since)}&limit=200`)).json();
      for (const c of page.changes) seen[`${c.entityType}:${c.entityId}`] = c.record.deletedAt ? "deleted" : "live";
      since = page.cursor;
      if (!page.hasMore) break;
    }
    const out = {};
    for (const [k, v] of Object.entries(seen)) {
      const t = k.split(":")[0];
      out[t] ||= { live: 0, deleted: 0 };
      out[t][v]++;
    }
    return out;
  });
/** What the device itself holds (IndexedDB), per store: {live, deleted}. */
const deviceCounts = (d) =>
  d.page.evaluate(async () => {
    const db = await new Promise((ok, no) => {
      const q = indexedDB.open("studio-wall-v1");
      q.onsuccess = () => ok(q.result);
      q.onerror = () => no(q.error);
    });
    const out = {};
    for (const s of ["boards", "pins", "feedback"]) {
      const all = await new Promise((ok) => {
        const q = db.transaction(s).objectStore(s).getAll();
        q.onsuccess = () => ok(q.result);
      });
      out[s] = { live: all.filter((r) => !r.deleted_at).length, deleted: all.filter((r) => r.deleted_at).length };
    }
    db.close();
    return out;
  });

/* ---- the run ------------------------------------------------------------------ */
const { proc } = startServer();
let browser;
try {
  await waitUp();
  browser = await chromium.launch(launch);
  const A = await device(browser, "desktop", { width: 1280, height: 900 });
  const B = await device(browser, "phone", { width: 390, height: 844 });

  console.log("signed out");
  await ready(A);
  // A library made before sign-in: it stays on this device until stage 4's import. A board with an idea, a picture
  // and a comment; a deleted picture; a deleted board with two cards (one a picture).
  await newBoard(A, "Old board");
  await addIdea(A, "Old idea", "From before the studio");
  await addPicture(A, "Old picture");
  await A.page.fill("#feedback-text", "An older comment");
  await A.page.click("#feedback-form button");
  await A.page.waitForSelector('.feedback article:has-text("An older comment")');
  await addPicture(A, "Deleted picture");
  await A.page.click('.pin:has-text("Deleted picture")');
  await A.page.click("#delete-pin");
  await A.page.waitForFunction(() => ![...document.querySelectorAll(".pin")].some((p) => p.textContent.includes("Deleted picture")));
  await newBoard(A, "Old deleted board");
  await addIdea(A, "On a deleted board", "Gone with its board");
  await addPicture(A, "Deleted with its board");
  await deleteBoard(A);
  await A.page.reload();
  await A.page.waitForSelector(".topline h1");
  check("signed out: nothing calls /v1", A.v1.length === 0, A.v1.join(", "));
  check("signed out: the studio code isn't loaded", A.chunks.length === 0, A.chunks.join(", "));

  console.log("sign-in");
  await signIn(A);
  check("sign-in: the panel offers old sync (checked) and studio sync", await A.page.isChecked("[name=st-mode][value=old]"));
  check("sign-in: nothing syncs yet", !A.v1.some((p) => p.startsWith("/v1/sync")), A.v1.join(", "));

  console.log("switch");
  await switchToStudio(A);
  await statusIs(A, "Studio · synced");
  let boards = (await studioList(A, "/v1/boards")).items;
  check("switch: the Inbox goes up, the older board stays here", JSON.stringify(boards.map((b) => b.name).sort()) === '["Inbox"]', JSON.stringify(boards?.map((b) => b.name)));

  // A new board, an idea, a picture and a comment.
  await A.page.click(visible("[data-action=new-board]"));
  await A.page.fill("#modal [name=name]", "Moodboard");
  await A.page.click("#modal .submit");
  await A.page.waitForSelector('.topline h1:has-text("Moodboard")');
  await addIdea(A, "Warm light", "Late afternoon on the wall");
  await A.page.click(visible(".header-actions [data-action=save]"));
  await A.page.click("[data-kind=image]");
  await A.page.setInputFiles("#upload", { name: "gradient.png", mimeType: "image/png", buffer: png() });
  await A.page.fill("#save-form [name=title]", "Gradient");
  await A.page.click("#save-form .submit");
  await A.page.waitForFunction(() => !document.querySelector("#modal")?.open);
  await A.page.fill("#feedback-text", "Love this direction");
  await A.page.click("#feedback-form button");
  await A.page.waitForSelector('.feedback article:has-text("Love this direction")');
  const studioHas = async () => {
    const b = (await studioList(A, "/v1/boards")).items || [];
    const mood = b.find((x) => x.name === "Moodboard");
    const pins = mood ? (await studioList(A, `/v1/pins?boardId=${mood.id}`)).items || [] : [];
    const fb = mood ? (await studioList(A, `/v1/feedback?boardId=${mood.id}`)).items || [] : [];
    return { mood, pins, fb };
  };
  let up = { pins: [] };
  for (let i = 0; i < 40; i++) {
    up = await studioHas();
    if (up.pins.length === 2 && up.pins.some((p) => p.fileId) && up.fb.length === 1) break;
    await A.page.evaluate(() => dispatchEvent(new Event("focus")));
    await new Promise((r) => setTimeout(r, 1000));
  }
  check("desktop: the board, both cards, the picture and the comment are in the studio", up.pins.length === 2 && up.pins.some((p) => p.kind === "image" && p.fileId) && up.fb.length === 1, JSON.stringify({ pins: up.pins.map((p) => [p.title, p.fileId]), fb: up.fb?.length }));
  check("desktop: the older board is still not in the studio", !((await studioList(A, "/v1/boards")).items || []).some((b) => b.name === "Old board"));

  console.log("device 2 (390 px)");
  await ready(B);
  await signIn(B);
  await switchToStudio(B);
  await statusIs(B, "Studio · synced");
  await until(B, () => [...document.querySelectorAll(".pin")].length >= 2, null, "gets the cards");
  await openBoard(B, "Moodboard");
  await hasCard(B, "Late afternoon on the wall", "has the idea card");
  await until(B, () => [...document.querySelectorAll(".pin img")].some((i) => i.complete && i.naturalWidth > 0), null, "the picture opens");
  check("phone: has the comment", await B.page.isVisible('.feedback article:has-text("Love this direction")'));
  check("phone: the desktop's older board didn't come", !(await B.page.evaluate(() => document.body.textContent.includes("Old board"))));
  boards = (await studioList(B, "/v1/boards")).items || [];
  check("phone: its Inbox maps onto the studio's (still one Inbox)", boards.filter((b) => b.name === "Inbox").length === 1, JSON.stringify(boards.map((b) => b.name)));
  check("phone: no sideways scroll at 390 px", await B.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  console.log("edits");
  await editNote(B, "Late afternoon on the wall", "Edited on the phone");
  await openBoard(A, "Moodboard");
  await hasCard(A, "Edited on the phone", "gets the phone's edit");

  console.log("offline");
  await A.ctx.setOffline(true);
  await editNote(A, "Edited on the phone", "Offline edit");
  await addIdea(A, "Made offline", "A card made with no network");
  await until(A, () => /^Studio · offline/.test(document.querySelector("[data-action=library]")?.title || ""), null, "says it's offline");
  await A.ctx.setOffline(false);
  await A.page.evaluate(() => dispatchEvent(new Event("online")));
  await hasCard(B, "Offline edit", "gets the offline edit after the reconnect");
  await hasCard(B, "A card made with no network", "gets the card made offline");

  console.log("conflict");
  await statusIs(A, "Studio · synced");
  await statusIs(B, "Studio · synced");
  await A.ctx.setOffline(true);
  await B.ctx.setOffline(true);
  await editNote(A, "Offline edit", "From the desktop");
  await editNote(B, "Offline edit", "From the phone");
  await A.ctx.setOffline(false);
  await A.page.evaluate(() => dispatchEvent(new Event("online")));
  await statusIs(A, "Studio · synced");
  await B.ctx.setOffline(false);
  await B.page.evaluate(() => dispatchEvent(new Event("online")));
  await hasCard(B, "From the desktop", "the studio kept the first version");
  await until(B, () => /card to review/.test(document.querySelector("[data-action=library]")?.title || ""), null, "says there is a card to review");
  await openStudio(B);
  check("phone: the review card is in Studio account", await B.page.isVisible("[data-keep]"));
  await shot(B, "review");
  await B.page.click("[data-keep]");
  await B.page.waitForSelector("#st-signed-in");
  await B.page.waitForFunction(() => !document.querySelector("[data-keep]"));
  await B.page.click("#modal .close");
  await hasCard(B, "From the phone", "its own version is back");
  await hasCard(A, "From the phone", "gets the phone's version once it was chosen");

  console.log("delete");
  await deleteBoard(A);
  await until(A, () => !document.body.textContent.includes("Moodboard"), null, "the board is deleted here");
  await until(B, () => !document.body.textContent.includes("Moodboard"), null, "the deleted board goes");
  await B.page.click(visible(".mobile-brand [data-action=library]"));
  await B.page.click("#open-trash");
  await B.page.click('.trash-row:has-text("Moodboard") [data-restore-board]');
  await B.page.waitForFunction(() => !document.querySelector("#modal")?.open || !document.querySelector(".trash-row"));
  if (await B.page.evaluate(() => document.querySelector("#modal")?.open)) await B.page.click("#modal .close");
  await until(A, () => document.body.textContent.includes("Moodboard"), null, "the restored board is back");
  await openBoard(A, "Moodboard");
  await until(A, () => document.querySelectorAll(".pin").length === 3, null, "with its three cards");

  console.log("import");
  await statusIs(B, "Studio · synced");
  await openStudio(A);
  check("import: the button is in Studio account", await A.page.isVisible("#st-import"));
  const importNow = async () => {
    await A.page.click("#st-import");
    await A.page.waitForFunction(() => /^Done\./.test(document.querySelector("#st-import-msg")?.textContent || ""), null, { timeout: 180_000 });
    return A.page.textContent("#st-import-msg");
  };
  const said = await importNow();
  await shot(A, "imported");
  check("import: says it's done, with counts", /In the studio: \d+ of \d+ boards, \d+ of \d+ cards, \d+ of \d+ comments/.test(said), said);
  const inStudio = await studioCounts(A);
  const onDesktop = await deviceCounts(A);
  const same = (a, b) => a?.live === b?.live && a?.deleted === b?.deleted;
  check(
    "import: the studio has every board, card and comment on the desktop, Recently deleted included",
    same(inStudio.board, onDesktop.boards) && same(inStudio.pin, onDesktop.pins) && same(inStudio.feedback, onDesktop.feedback),
    JSON.stringify({ inStudio, onDesktop }),
  );
  check("import: the desktop's deleted things are deleted in the studio too", inStudio.board?.deleted >= 1 && inStudio.pin?.deleted >= 3, JSON.stringify(inStudio));
  const again = await importNow();
  check("import: a second run adds nothing", JSON.stringify(await studioCounts(A)) === JSON.stringify(inStudio), `${again} ${JSON.stringify(await studioCounts(A))}`);
  await A.page.click("#modal .close");

  await until(B, () => document.body.textContent.includes("Old board"), null, "gets the older board");
  let counts = {};
  for (let i = 0; i < 60; i++) {
    counts = { desktop: await deviceCounts(A), phone: await deviceCounts(B) };
    if (JSON.stringify(counts.desktop) === JSON.stringify(counts.phone)) break;
    await B.page.evaluate(() => dispatchEvent(new Event("focus")));
    await new Promise((r) => setTimeout(r, 1000));
  }
  check("phone: the same counts as the desktop (boards, cards, comments; live and deleted)", JSON.stringify(counts.desktop) === JSON.stringify(counts.phone), JSON.stringify(counts));
  await openBoard(B, "Old board");
  await hasCard(B, "From before the studio", "has the older idea card");
  await until(B, () => [...document.querySelectorAll(".pin")].some((p) => p.textContent.includes("Old picture") && p.querySelector("img")?.complete && p.querySelector("img").naturalWidth > 0), null, "the older picture opens");
  check("phone: has the older comment", await B.page.isVisible('.feedback article:has-text("An older comment")'));
  check("phone: the deleted board isn't on the board list", !(await B.page.evaluate(() => [...document.querySelectorAll(".board-card")].some((b) => b.textContent.includes("Old deleted board")))));

  await openTrash(B);
  await shot(B, "recently-deleted");
  check("phone: Recently deleted has the deleted picture and the deleted board", (await B.page.isVisible('.trash-row:has-text("Deleted picture")')) && (await B.page.isVisible('.trash-row:has-text("Old deleted board")')));
  await until(B, () => [...document.querySelectorAll(".trash-row")].some((r) => r.textContent.includes("Deleted picture") && r.querySelector("img")?.complete && r.querySelector("img").naturalWidth > 0), null, "the deleted picture's thumbnail opens");
  // One at a time: a sync landing meanwhile redraws the page under the dialog.
  for (const [text, attr] of [["Deleted picture", "data-restore-pin"], ["Old deleted board", "data-restore-board"]]) {
    if (!(await B.page.evaluate(() => document.querySelector("#modal")?.open && !!document.querySelector(".trash-list")))) await openTrash(B);
    await B.page.click(`.trash-row:has-text("${text}") [${attr}]`);
    await B.page.waitForFunction((t) => ![...document.querySelectorAll(".trash-row")].some((r) => r.textContent.includes(t)), text);
  }
  if (await B.page.evaluate(() => document.querySelector("#modal")?.open)) await B.page.click("#modal .close");
  await openBoard(A, "Old board");
  await hasCard(A, "Deleted picture", "gets the card restored on the phone");
  await until(A, () => document.body.textContent.includes("Old deleted board"), null, "gets the board restored on the phone");
  await openBoard(A, "Old deleted board");
  await until(A, () => document.querySelectorAll(".pin").length === 2, null, "with both its cards");
  await until(A, () => [...document.querySelectorAll(".pin img")].some((i) => i.complete && i.naturalWidth > 0), null, "and its picture");

  console.log("sign-out");
  await openStudio(B);
  await Promise.all([B.page.waitForEvent("load"), B.page.click("#st-signout")]);
  await B.page.waitForSelector(".topline h1");
  check("sign-out: back to old sync", (await B.page.getAttribute("[data-action=library]", "title")) !== "Studio · synced");
  check("sign-out: the boards stay on the phone", await B.page.evaluate(() => document.body.textContent.includes("Moodboard")));

  for (const d of [A, B]) check(`${d.name}: no page errors`, d.errors.length === 0, d.errors.slice(0, 5).join(" | "));
} catch (e) {
  fails.push(`crashed: ${e.stack || e}`);
  console.log(e);
  console.log(log.slice(-4000));
} finally {
  await browser?.close();
  proc.kill();
}
console.log(`\n${passed} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
process.exit(0);
