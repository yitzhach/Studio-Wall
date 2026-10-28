// The page itself: sidebar, header, client news, the boards grid or a board's cards, the conversation and the footer.
// render() redraws all of it from ui; refresh() reloads the library first. main.ts wires the buttons after each draw.
import {colourWords} from '../colour';
import {historyStatus, snapshot, file, type Board, type Pin} from '../data';
import {esc} from '../text';
import {
  ui,
  selection,
  urls,
  boardNow,
  pinsFor,
  starred,
  clientStars,
  pickers,
  isPick,
  seenMarks,
  markSeen,
  clientCount,
  clientRemovals,
  newsBadge,
  author,
  image,
  commentsAllowed,
} from './state';
import {icon, paintIcons} from './kit';
import {syncLabel, syncState} from './sync-status';

const root = () => document.querySelector<HTMLDivElement>('#app')!;
const buildDate = new Date(__BUILD_TIME__);
const buildVersion =
  'v' + __BUILD_TIME__.slice(0, 10).replaceAll('-', '.') + '-' + __BUILD_TIME__.slice(11, 16).replace(':', '');
const buildLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(buildDate);

// Back / forward between views, like a browser's history but inside the app.
const navTrail = ['all'];
let navIndex = 0;
export function navigate(next: string, record = true, redraw = true) {
  if (next === ui.view) {
    if (redraw) render();
    return;
  }
  ui.view = next;
  ui.query = '';
  ui.filter = 'all';
  ui.pickClient = '';
  selection.clear();
  ui.selecting = false;
  ui.selectionAnchor = null;
  ui.client = false;
  if (record) {
    navTrail.splice(navIndex + 1);
    navTrail.push(next);
    navIndex = navTrail.length - 1;
  }
  if (redraw) render();
}
export function back() {
  if (navIndex > 0) {
    navIndex--;
    navigate(navTrail[navIndex], false);
  }
}
export function forward() {
  if (navIndex < navTrail.length - 1) {
    navIndex++;
    navigate(navTrail[navIndex], false);
  }
}

export async function refresh() {
  ui.data = await snapshot();
  if (!['all', 'boards'].includes(ui.view) && !ui.data.boards.some(b => b.id === ui.view)) ui.view = 'all';
  for (const p of ui.data.pins)
    if (p.file_ref && !urls.has(p.file_ref)) {
      const blob = await file(p.file_ref);
      if (blob) urls.set(p.file_ref, URL.createObjectURL(blob));
    }
  render();
}

let afterRender = () => {};
/** main.ts hands in the function that wires up the freshly drawn page. */
export const onRender = (f: () => void) => (afterRender = f);

// When this board was last opened, so client comments that arrived since are highlighted during this visit.
let visitBoard = '',
  visitSince = '';

export function render() {
  if (ui.view !== visitBoard) {
    visitBoard = ui.view;
    visitSince = seenMarks()[ui.view] || '';
  }
  if (ui.data.boards.some(b => b.id === ui.view) && !ui.client) markSeen(ui.view);
  for (const id of selection) if (!ui.data.pins.some(p => p.id === id)) selection.delete(id);
  const board = boardNow();
  if (ui.client && !board) ui.client = false;
  const title = board?.name || (ui.view === 'boards' ? 'Your boards' : 'All inspiration');
  const picks = board && !ui.client ? pickers(board.id) : [];
  const pins = visibleCards(board, picks);
  ui.visiblePins = pins;
  root().innerHTML =
    `${sidebar()}\n <main>${header(board, title)}\n ${clientNewsBars(board)}\n ${intro(board)}\n ${ui.view === 'boards' ? boardGrid() : toolbar(pins, picks) + cardGrid(pins)}\n ${board ? conversation(board) : ''}` +
    `${footer()}</main>${mobileNav()}<input id="zip-input" type="file" accept=".zip" hidden><dialog id="modal"></dialog>`;
  afterRender();
  paintIcons();
}

/** The cards this view shows: the board's (or all), searched, filtered and newest first (client picks: most starred first). */
function visibleCards(board: Board | undefined, picks: ReturnType<typeof pickers>) {
  let pins = board ? pinsFor(board.id) : ui.data.pins;
  if (ui.query) {
    const q = ui.query.toLowerCase();
    pins = pins.filter(p =>
      [p.note, p.meta.title, p.source_credit, ...p.tags, ...p.palette, ...p.palette.flatMap(colourWords)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }
  if (ui.pickClient && !picks.some(c => c.by === ui.pickClient)) ui.pickClient = '';
  if (ui.filter === 'picks' && !picks.length) ui.filter = 'all';
  if (ui.filter !== 'all')
    pins = pins.filter(p =>
      ui.filter === 'starred'
        ? starred(p)
        : ui.filter === 'picks'
          ? isPick(p)
          : ui.filter === 'images'
            ? p.meta.kind === 'image'
            : p.meta.kind !== 'image',
    );
  return [...pins].sort(
    (a, b) =>
      (ui.filter === 'picks' ? clientStars(b).length - clientStars(a).length : 0) ||
      b.created_at.localeCompare(a.created_at),
  );
}

function sidebar() {
  const inbox = ui.data.boards.find(b => b.name === 'Inbox');
  const places = [
    ['all', 'layout-grid', 'All inspiration'],
    [inbox?.id || '', 'inbox', 'Inbox'],
    ['boards', 'panels-top-left', 'Boards'],
  ]
    .map(
      ([id, ic, n]) =>
        `<button data-nav="${id}" class="nav-item ${ui.view === id ? 'active' : ''}">${icon(ic)}${n}${id === inbox?.id ? `<small>${pinsFor(id).length}</small>` : ''}</button>`,
    )
    .join('');
  const boards =
    ui.data.boards
      .filter(b => b.name !== 'Inbox')
      .map(
        b =>
          `<button class="nav-item ${ui.view === b.id ? 'active' : ''}" data-nav="${b.id}">${icon('square')}<span>${esc(b.name)}</span>${newsBadge(b.id)}</button>`,
      )
      .join('') || '<p class="hint">Make room for your next idea.</p>';
  return `<aside class="sidebar"><a class="brand" href="#">STUDIO<span>WALL</span><b>◧</b></a><div class="workspace-label">YOUR CREATIVE SPACE</div><nav>${places}</nav><div class="section-label">MY BOARDS<button data-action="new-board" aria-label="Create board">${icon('plus')}</button></div><div class="board-nav">${boards}</div><div class="sidebar-foot"><button data-action="sample">${icon('panels-top-left')} Try collaboration demo</button><button data-action="library">${icon('arrow-left-right')} Back up / move devices</button><button data-action="studio">${icon('user-round')} Studio account</button><button data-action="trash">${icon('trash-2')} Recently deleted</button><button data-action="theme">${icon(ui.theme === 'dark' ? 'sun' : 'moon')} ${ui.theme === 'dark' ? 'Light' : 'Dark'} mode</button><span class="sync-label">${icon('hard-drive')} ${esc(syncLabel())}</span></div></aside>`;
}

/** The phone header, the client preview banner, and the title row with history and the board's buttons. */
function header(board: Board | undefined, title: string) {
  const mobile = `<header class="mobile-brand">STUDIO WALL<button data-action="library" data-sync="${syncState()}" title="${esc(syncLabel())}" aria-label="Back up, move devices and sync status">${icon('arrow-left-right')}</button><button data-action="theme" aria-label="Toggle colour theme">${icon(ui.theme === 'dark' ? 'sun' : 'moon')}</button></header>`;
  const preview = ui.client
    ? `<div class="preview-banner">${icon('eye')} Client preview · on this device only<button data-action="exit-preview">Exit preview</button></div>`
    : '';
  const history = `<div class="app-history"><button data-action="back" aria-label="Back" title="Back" ${navIndex === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><button data-action="forward" aria-label="Forward" title="Forward" ${navIndex >= navTrail.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button><span></span><button data-action="undo" aria-label="Undo" title="Undo" ${historyStatus().canUndo ? '' : 'disabled'}>${icon('undo-2')}</button><button data-action="redo" aria-label="Redo" title="Redo" ${historyStatus().canRedo ? '' : 'disabled'}>${icon('redo-2')}</button></div>`;
  const actions = `${board && !ui.client ? `<button class="secondary" data-action="board-menu" aria-label="Board options">${icon('ellipsis')}</button><button class="secondary" data-action="share">${icon('users')}<span>Collaborate</span></button>` : ''}<button class="primary" data-action="save" ${ui.client && board?.share_settings?.permission !== 'contribute' ? 'disabled' : ''}>${icon('plus')} ${ui.client ? 'Add reference' : 'Add'}</button>`;
  return `${mobile}${preview}<div class="topline"><div><div class="eyebrow">${ui.client ? 'A BOARD TO EXPLORE TOGETHER' : board ? 'COLLECTION' : 'COLLECT. CONNECT. CREATE.'}</div><h1>${esc(title)}<span class="private">${icon('lock')} Private</span></h1>${history}</div><div class="header-actions">${actions}</div></div>`;
}

/** On All / Boards: which boards have news from clients. On a board: cards a client removed since your last visit. */
function clientNewsBars(board: Board | undefined) {
  if (['all', 'boards'].includes(ui.view)) {
    const news = ui.data.boards.map(b => ({b, n: clientCount(b.id)})).filter(x => x.n);
    return news.length
      ? `<div class="client-news-bar">${icon('message-circle')} New from clients:${news.map(x => `<button data-nav="${x.b.id}">${esc(x.b.name)} <b class="client-news">${x.n}</b></button>`).join('')}</div>`
      : '';
  }
  if (!board || ui.client) return '';
  const gone = clientRemovals(board.id, visitSince);
  if (!gone.length) return '';
  const names = [...new Set(gone.map(p => p.contributor_name || 'A client'))];
  return `<div class="client-news-bar">${icon('trash-2')} ${esc(names.join(', '))} removed ${gone.length === 1 ? `“${esc(gone[0].meta.title || gone[0].note || 'a card')}”` : gone.length + ' cards'} they added.<button data-action="trash">Recently deleted</button></div>`;
}

function intro(board: Board | undefined) {
  return `<p class="intro">${esc(board?.description || (ui.view === 'boards' ? 'Gather references around a project, a palette, or a possibility.' : 'Images, materials, and ideas worth coming back to.'))}</p>`;
}

function boardGrid() {
  return `<div class="board-grid">${ui.data.boards
    .map(b => {
      const ps = pinsFor(b.id);
      const cover = ps.find(p => p.id === b.cover_pin_id) || ps.find(p => image(p));
      return `<article class="board-card"><button data-nav="${b.id}"><div class="board-cover">${cover && image(cover) ? `<img src="${image(cover)}" alt="${esc(b.name)}">` : `${icon('panels-top-left')}<span>${esc(b.name)}</span>`}</div><h3>${esc(b.name)}${newsBadge(b.id)}</h3><p>${ps.length} reference${ps.length === 1 ? '' : 's'}</p></button><div class="board-order"><button data-up="${b.id}" aria-label="Move ${esc(b.name)} earlier">${icon('arrow-left')}</button></div></article>`;
    })
    .join('')}<button class="new-board-card" data-action="new-board">${icon('plus')}Create a board</button></div>`;
}

/** Search, filters, Present and Select; the client-picks row; the selection bar; the drag hint. */
function toolbar(pins: Pin[], picks: ReturnType<typeof pickers>) {
  const filters = [
    ['all', 'All'],
    ['images', 'Images'],
    ['ideas', 'Ideas & links'],
    ['starred', '★ Starred'],
    ...(picks.length ? [['picks', 'Client picks']] : []),
  ]
    .map(([id, n]) => `<button data-filter="${id}" class="${ui.filter === id ? 'chosen' : ''}">${n}</button>`)
    .join('');
  const pickRow =
    ui.filter === 'picks'
      ? `<div class="pick-clients" role="group" aria-label="Choose a client"><span>Starred by</span><button data-pick-client="" class="${ui.pickClient ? '' : 'chosen'}">All clients</button>${picks.map(c => `<button data-pick-client="${esc(c.by)}" class="${ui.pickClient === c.by ? 'chosen' : ''}">${esc(c.name)} <b>${c.n}</b></button>`).join('')}</div>`
      : '';
  const selectionBar =
    ui.selecting || selection.size
      ? `<div class="selection-bar"><strong>${selection.size} selected</strong><button data-action="select-all">Select visible</button><button data-action="clear-selection">Clear</button>${boardNow() && !ui.client ? `<button data-action="share-selected" ${selection.size ? '' : 'disabled'}>Share selected</button>` : ''}<button class="primary" data-action="transfer" ${selection.size ? '' : 'disabled'}>Copy / move to board</button></div>`
      : '';
  return `<div class="toolbar"><label class="search">${icon('search')}<input id="search" value="${esc(ui.query)}" placeholder="Search notes, tags or colours (e.g. blue, warm)" aria-label="Search inspiration"><kbd>/</kbd></label><div class="filters">${filters}</div><button class="secondary" data-action="present">Present / PDF</button><button class="secondary selection-toggle" data-action="select">${ui.selecting ? 'Done' : 'Select'}</button><span class="count">${pins.length} reference${pins.length === 1 ? '' : 's'}</span></div>${pickRow}${selectionBar}<p class="selection-hint">Drag a selection box from empty space around images, then drag the group onto a board · Shift / ⌘ / Ctrl to add</p>`;
}

/** The cards, or an empty state that offers a first save or the sample board. */
function cardGrid(pins: Pin[]) {
  if (pins.length) return `<div class="masonry">${pins.map(card).join('')}</div>`;
  return `<div class="empty"><div class="empty-icon">${icon(ui.query ? 'search' : 'image-plus')}</div><h2>${ui.query ? 'Nothing here yet.' : 'A little space for your next big idea.'}</h2><p>${ui.query ? 'Try another note, tag, or palette hex colour.' : 'Drop an image here, save a link, or jot down a thought. Your collection starts with one reference.'}</p>${!ui.query ? '<button class="primary" data-action="save">Save your first reference</button><button class="text-button" data-action="sample">Try a sample board</button>' : ''}</div>`;
}

export function chips(p: Pin) {
  return `<div class="swatches">${p.palette.map(c => `<button type="button" class="swatch" style="background:${esc(c)}" title="Find ${esc(c)}" aria-label="Find colour ${esc(c)}" data-colour="${esc(c)}"></button>`).join('')}</div>`;
}

function card(p: Pin) {
  const img = image(p),
    marks = p.annotations?.length || 0;
  return `<div class="pin-wrap ${selection.has(p.id) ? 'is-selected' : ''}" draggable="true" data-drag-pin="${p.id}">${ui.selecting ? `<button class="select-pin" data-select-pin="${p.id}" aria-label="Select ${esc(p.meta.title || 'reference')}" aria-pressed="${selection.has(p.id)}">${selection.has(p.id) ? '✓' : '○'}</button>` : ''}<button class="pin ${img ? '' : 'text-pin'}" data-pin="${p.id}">${img ? `<img draggable="false" src="${img}" alt="${esc(p.meta.title || p.note || 'Saved inspiration')}" loading="lazy">` : `<div class="idea-content">${icon(p.meta.kind === 'link' ? 'link' : 'quote')}<p>${esc(p.note || p.meta.title || p.source_url)}</p></div>`}<div class="caption"><strong>${starred(p) ? '★ ' : ''}${esc(p.meta.title || (p.meta.kind === 'idea' ? 'A thought to keep' : 'Untitled reference'))}</strong><span>${p.contributor_name ? `<span class="client-stars">Added by ${esc(p.contributor_name)}</span>${p.source_credit ? ' · ' + esc(p.source_credit) : ''}` : esc(p.is_own ? 'My own work' : p.source_credit || 'Credit not added')}${p.source_url ? ' · Source ↗' : ''}${
    !ui.client && clientStars(p).length
      ? ` · <span class="client-stars" title="Starred by ${esc(
          clientStars(p)
            .map(f => f.author_name)
            .join(', '),
        )}">★ ${clientStars(p).length} client${clientStars(p).length === 1 ? '' : 's'}</span>`
      : ''
  }${ui.data.feedback.filter(f => f.pin_id === p.id && f.board_id === p.board_id && f.text).length ? ` · ${ui.data.feedback.filter(f => f.pin_id === p.id && f.board_id === p.board_id && f.text).length} comments` : ''}${marks ? ` · ${marks} markup${marks === 1 ? '' : 's'}` : ''}</span></div></button></div>`;
}

/** The board's comments (yours and clients'), with the new ones since this visit marked, and the comment box. */
function conversation(board: Board) {
  const comments = ui.data.feedback
    .filter(f => f.board_id === board.id && f.text)
    .map(
      f =>
        `<article class="${f.author_name && f.updated_at > visitSince ? 'is-new' : ''}"><strong>${esc(author(f))} <small>${f.author_name ? 'Client link' : 'This device'}${f.pin_id ? ' · ' + esc(ui.data.pins.find(p => p.id === f.pin_id)?.meta.title || 'Reference') : ''}</small></strong><p>${esc(f.text)}</p></article>`,
    )
    .join('');
  return `<section class="feedback"><div><div class="eyebrow">THE CONVERSATION</div><h2>Thoughts & direction</h2><p>Your notes and your clients’ comments from share links, together. With sync on they reach all your devices.</p></div><div>${comments}<form id="feedback-form" ${ui.client && !commentsAllowed(board.id) ? 'hidden' : ''}><label for="feedback-text">Add a thought</label><textarea id="feedback-text" required maxlength="4000" placeholder="What speaks to you about this direction?"></textarea><button class="primary">Add comment</button></form></div></section>`;
}

function footer() {
  return `<footer class="page-foot">Your inspiration, in one place.<span>Private · only you and the clients you share links with</span><span class="build-stamp" title="Version uses UTC; build time shown in Eastern Time"><strong>${buildVersion}</strong> · built <time datetime="${__BUILD_TIME__}">${buildLabel} ET</time></span></footer>`;
}

function mobileNav() {
  return `<nav class="mobile-nav"><button data-nav="all" class="${ui.view === 'all' ? 'active' : ''}">${icon('layout-grid')}Inspiration</button><button data-nav="boards" class="${ui.view === 'boards' ? 'active' : ''}">${icon('panels-top-left')}Boards</button><button class="mobile-save" data-action="save">${icon('plus')}Save</button></nav>`;
}
