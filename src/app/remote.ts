// Changes that arrive from elsewhere (old sync, studio sync): reload the page and say what clients did.
import {ui} from './state';
import {toast, show} from './kit';
import {refresh} from './render';
import {setStudioStatus} from './sync-status';

// Studio sync (src/studio.ts, loaded only when signed in) replaces old sync on a device that switched to it.
export const studioHost = {
  refresh: () => remoteChanged(),
  toast,
  show: (html: string) => show(html),
  setStatus: setStudioStatus,
};
export const loadStudio = () => import('../studio').then(m => m.connect(studioHost));
// Remote changes re-render the board; wait while a dialog is open so in-progress edits aren't wiped.
let remotePending = false;
export function remoteChanged() {
  const before = new Set(ui.data.feedback.map(f => f.id + f.updated_at)),
    known = new Set(ui.data.pins.map(p => p.id)),
    gone = new Set(ui.data.removed.map(p => p.id));
  const done = () => {
    const fresh = ui.data.feedback.filter(f => f.author_name && !before.has(f.id + f.updated_at)),
      added = ui.data.pins.filter(p => p.contributor_name && !known.has(p.id)),
      removed = ui.data.removed.filter(p => !gone.has(p.id));
    if (removed.length && !added.length && !fresh.length) {
      const p = removed[0],
        b = ui.data.boards.find(x => x.id === p.board_id);
      toast(
        removed.length > 1
          ? `Clients removed ${removed.length} cards · see Recently deleted`
          : `${p.contributor_name || 'A client'} removed a card${b ? ' from ' + b.name : ''} · see Recently deleted`,
      );
    } else if (added.length && !fresh.length) {
      const p = added[0],
        b = ui.data.boards.find(x => x.id === p.board_id);
      toast(
        added.length > 1
          ? `${added.length} new cards from clients`
          : `${p.contributor_name} added a card${b ? ' to ' + b.name : ''}`,
      );
    } else if (fresh.length) {
      const f = fresh[0],
        b = ui.data.boards.find(x => x.id === f.board_id);
      toast(
        fresh.length > 1
          ? `${fresh.length} new client responses`
          : `${f.author_name} ${f.text ? 'commented' : 'starred an image'}${b ? ' on ' + b.name : ''}`,
      );
    }
  };
  const go = () => refresh().then(done);
  const d = document.querySelector<HTMLDialogElement>('#modal');
  if (d?.open) {
    remotePending = true;
    d.addEventListener(
      'close',
      () => {
        if (remotePending) {
          remotePending = false;
          go();
        }
      },
      {once: true},
    );
  } else go();
}
