// What the owner app is showing right now, shared by every part of it, and the questions asked of the library.
import type {snapshot, Pin, Feedback} from '../data';

export const ui = {
  /** The library as last read from this device (refresh() in render.ts reloads it). */
  data: undefined as unknown as Awaited<ReturnType<typeof snapshot>>,
  /** 'all', 'boards' or a board's ID. */
  view: 'all',
  query: '',
  /** 'all', 'images', 'ideas', 'starred' or 'picks'. */
  filter: 'all',
  /** With the client-picks filter: one client's picks, or '' for all of them. */
  pickClient: '',
  /** The local client preview of the open board. */
  client: false,
  selecting: false,
  /** The cards on screen, in order: for the card dialog's previous/next and shift-click ranges. */
  visiblePins: [] as Pin[],
  selectionAnchor: null as string | null,
  theme: localStorage.getItem('studio-wall-theme') || 'dark',
};
document.documentElement.dataset.theme = ui.theme;
export const selection = new Set<string>();
/** Object URLs for image files, by file ref. */
export const urls = new Map<string, string>();

export const boardNow = () => ui.data.boards.find(b => b.id === ui.view);
export const pinsFor = (id: string) => ui.data.pins.filter(p => p.board_id === id);
// Your own stars (and the local client preview's); stars from share links are client picks, counted per guest.
export const starred = (p: Pin) =>
  ui.data.feedback.some(f => f.board_id === p.board_id && f.pin_id === p.id && f.starred && !f.author_name);
export const clientStars = (p: Pin) =>
  ui.data.feedback.filter(f => f.board_id === p.board_id && f.pin_id === p.id && f.starred && f.author_name);
export const pickers = (id: string) => {
  const m = new Map<string, {name: string; n: number}>();
  for (const p of pinsFor(id))
    for (const f of clientStars(p)) {
      const e = m.get(f.created_by) || {name: f.author_name!, n: 0};
      e.n++;
      m.set(f.created_by, e);
    }
  return [...m].map(([by, v]) => ({by, ...v})).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
};
export const isPick = (p: Pin) => clientStars(p).some(f => !ui.pickClient || f.created_by === ui.pickClient);
export const commentsAllowed = (id: string) => {
  const b = ui.data.boards.find(b => b.id === id);
  return !!b && b.comments_enabled !== false && b.share_settings?.permission !== 'view';
};
// New client activity (comments and stars arriving from share links). "Seen" marks are a per-device convenience only.
const SEEN_KEY = 'studio-wall-client-seen';
export const seenMarks = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  } catch {
    return {};
  }
};
export const markSeen = (id: string) => {
  try {
    const s = seenMarks();
    s[id] = new Date().toISOString();
    localStorage.setItem(SEEN_KEY, JSON.stringify(s));
  } catch {}
};
const clientAdds = (id: string, since = seenMarks()[id] || '') =>
  ui.data.pins.filter(p => p.board_id === id && p.contributor_name && p.created_at > since);
const clientNews = (id: string, since = seenMarks()[id] || '') =>
  ui.data.feedback.filter(f => f.board_id === id && f.author_name && (f.text || f.starred) && f.updated_at > since);
// Cards a client removed through a contribute link (deleted_by guest:…); they wait in Recently deleted.
export const clientRemovals = (id: string, since = seenMarks()[id] || '') =>
  ui.data.removed.filter(p => p.board_id === id && String(p.deleted_at) > since);
export const clientCount = (id: string) => clientNews(id).length + clientAdds(id).length + clientRemovals(id).length;
export const newsBadge = (id: string) => {
  const n = clientCount(id);
  return n ? `<b class="client-news" title="${n} new from clients">${n}</b>` : '';
};
export const author = (f: Feedback) => (f.author_name ? f.author_name : 'You');
export const image = (p: Pin) => (p.file_ref ? urls.get(p.file_ref) : null);
