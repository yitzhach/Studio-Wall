// The owner app. src/app/ holds its parts: state.ts (what is on screen), render.ts (the page), kit.ts (icons, toasts,
// the dialog), save.ts, focus.ts, boards.ts and library.ts (the dialogs), sync-status.ts and remote.ts (sync).
// This file wires the drawn page's buttons, the page-wide drop / paste / keyboard handlers, and starts the app.
import './style.css';
import {bindMarquee} from './selection';
import {openPresentation} from './viewer';
import {initialize, action, undo, redo} from './data';
import {isImageFile} from './media';
import {importAny} from './backup';
import {startSync} from './sync';
import {studioSyncOn} from './studio-session';
import {esc, isHttpUrl} from './text';
import {ui, selection, boardNow, image} from './app/state';
import {toast, run} from './app/kit';
import {render, refresh, navigate, back, forward, onRender} from './app/render';
import {quickAddDialog, saveDialog} from './app/save';
import {focusPin} from './app/focus';
import {boardDialog, shareDialog, transferDialog, sample} from './app/boards';
import {libraryDialog, trashDialog} from './app/library';
import {studioHost, loadStudio, remoteChanged} from './app/remote';

const root = document.querySelector<HTMLDivElement>('#app')!;
/** Select or unselect a card; with shift, everything between it and the last card clicked. */
function toggleSelected(id: string, range = false) {
  const ids = ui.visiblePins.map(p => p.id);
  if (range && ui.selectionAnchor && ids.includes(ui.selectionAnchor)) {
    const a = ids.indexOf(ui.selectionAnchor),
      b = ids.indexOf(id);
    ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => selection.add(x));
  } else {
    selection.has(id) ? selection.delete(id) : selection.add(id);
    ui.selectionAnchor = id;
  }
  render();
}
// After every render: the page's buttons, drag and drop onto boards, search, import and the comment box.
onRender(bind);
function bind() {
  const grid = root.querySelector<HTMLElement>('.masonry');
  if (grid) bindMarquee(grid, selection, render);
  root
    .querySelectorAll<HTMLButtonElement>('[data-select-pin]')
    .forEach(b => (b.onclick = e => toggleSelected(b.dataset.selectPin!, e.shiftKey)));
  root.querySelectorAll<HTMLElement>('[data-drag-pin]').forEach(
    el =>
      (el.ondragstart = e => {
        const id = el.dataset.dragPin!;
        const ids = selection.has(id) ? [...selection] : [id];
        e.dataTransfer!.setData('application/x-studio-wall-pins', JSON.stringify(ids));
        e.dataTransfer!.effectAllowed = 'copyMove';
        const badge = document.createElement('div');
        badge.className = 'drag-badge';
        badge.textContent = `${ids.length} reference${ids.length === 1 ? '' : 's'}`;
        document.body.append(badge);
        e.dataTransfer!.setDragImage?.(badge, 20, 20);
        setTimeout(() => badge.remove(), 0);
      }),
  );
  root.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
    if (!ui.data.boards.some(b => b.id === el.dataset.nav)) return;
    el.ondragover = e => {
      if (e.dataTransfer?.types.includes('application/x-studio-wall-pins')) {
        e.preventDefault();
        el.classList.add('drop-target');
      }
    };
    el.ondragleave = () => el.classList.remove('drop-target');
    el.ondrop = e => {
      const raw = e.dataTransfer?.getData('application/x-studio-wall-pins');
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-target');
      try {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids) && ids.every(id => typeof id === 'string')) transferDialog(ids, el.dataset.nav);
      } catch {
        toast('Could not read the dragged references.');
      }
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(b => (b.onclick = () => navigate(b.dataset.nav!)));
  root.querySelectorAll<HTMLButtonElement>('[data-pin]').forEach(
    b =>
      (b.onclick = e => {
        if (ui.selecting || e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleSelected(b.dataset.pin!, e.shiftKey);
        } else focusPin(ui.data.pins.find(p => p.id === b.dataset.pin)!);
      }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(
    b =>
      (b.onclick = () => {
        ui.filter = b.dataset.filter!;
        ui.pickClient = '';
        render();
      }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-pick-client]').forEach(
    b =>
      (b.onclick = () => {
        ui.pickClient = b.dataset.pickClient!;
        render();
      }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(
    b =>
      (b.onclick = () => {
        const a = b.dataset.action;
        if (a === 'present') {
          const ps = selection.size ? ui.data.pins.filter(p => selection.has(p.id)) : ui.visiblePins;
          if (!ps.length) {
            toast('Choose some references first.');
            return;
          }
          openPresentation(ps, image, boardNow()?.name || 'Selected inspiration');
        }
        if (a === 'select') {
          ui.selecting = !ui.selecting;
          if (!ui.selecting) selection.clear();
          render();
        }
        if (a === 'select-all') {
          root.querySelectorAll<HTMLElement>('[data-pin]').forEach(el => selection.add(el.dataset.pin!));
          render();
        }
        if (a === 'clear-selection') {
          selection.clear();
          render();
        }
        if (a === 'transfer') transferDialog([...selection]);
        if (a === 'share-selected') {
          const b = boardNow();
          const ids = [...selection].filter(id => ui.data.pins.find(p => p.id === id)?.board_id === b?.id);
          if (ids.length) shareDialog(ids);
        }
        if (a === 'save') {
          if (ui.client && boardNow()?.share_settings?.permission !== 'contribute') {
            toast('This preview role cannot add references.');
            return;
          }
          quickAddDialog();
        }
        if (a === 'back') back();
        if (a === 'forward') forward();
        if (a === 'undo')
          run(async () => {
            if (await undo()) {
              await refresh();
              toast('Undone');
            }
          });
        if (a === 'redo')
          run(async () => {
            if (await redo()) {
              await refresh();
              toast('Redone');
            }
          });
        if (a === 'new-board') boardDialog();
        if (a === 'board-menu') boardDialog(boardNow());
        if (a === 'share') shareDialog();
        if (a === 'exit-preview') {
          ui.client = false;
          render();
        }
        if (a === 'theme') {
          ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
          localStorage.setItem('studio-wall-theme', ui.theme);
          document.documentElement.dataset.theme = ui.theme;
          render();
        }
        if (a === 'library') libraryDialog();
        if (a === 'studio')
          run(async () => {
            (await loadStudio()).panel();
          });
        if (a === 'trash') trashDialog();
        if (a === 'import') root.querySelector<HTMLInputElement>('#zip-input')!.click();
        if (a === 'sample') run(sample);
      }),
  );
  root.querySelector<HTMLInputElement>('#search')?.addEventListener('input', e => {
    const target = e.target as HTMLInputElement;
    const position = target.selectionStart;
    ui.query = target.value;
    render();
    const n = root.querySelector<HTMLInputElement>('#search')!;
    n.focus();
    n.setSelectionRange(position, position);
  });
  root.querySelector<HTMLInputElement>('#zip-input')!.onchange = e =>
    run(async () => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (f) {
        document.querySelector<HTMLDialogElement>('#modal')?.close();
        const r = await importAny(f);
        if (r.kind === 'board') {
          navigate(r.board.id, true, false);
          await refresh();
          toast('Board imported');
        } else {
          await refresh();
          toast(
            r.counts.boards + r.counts.pins + r.counts.feedback
              ? `Added or updated ${r.counts.boards} boards, ${r.counts.pins} references`
              : 'Already up to date',
          );
        }
      }
    });
  root.querySelectorAll<HTMLButtonElement>('[data-up]').forEach(
    b =>
      (b.onclick = () =>
        run(async () => {
          const index = ui.data.boards.findIndex(x => x.id === b.dataset.up);
          if (index < 1) return;
          const current = ui.data.boards[index],
            prev = ui.data.boards[index - 1];
          await action({type: 'board.update', id: current.id, payload: {position: prev.position}});
          await action({type: 'board.update', id: prev.id, payload: {position: current.position}});
          await refresh();
        })),
  );
  root.querySelector<HTMLFormElement>('#feedback-form')?.addEventListener('submit', e => {
    e.preventDefault();
    run(async () => {
      await action({
        type: 'feedback.add',
        payload: {
          board_id: ui.view,
          text: root.querySelector<HTMLTextAreaElement>('#feedback-text')!.value,
          client_preview: ui.client,
        },
      });
      await refresh();
      toast('Comment saved locally');
    });
  });
}
document.addEventListener('dragover', e => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dragging');
  }
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const fs = Array.from(e.dataTransfer?.files || []).filter(f => isImageFile(f));
  if (fs.length) {
    document.querySelector<HTMLDialogElement>('dialog')?.close();
    saveDialog(fs);
  }
});
document.addEventListener('paste', e => {
  if ((e.target as HTMLElement).matches('input,textarea')) return;
  const fs = Array.from(e.clipboardData?.files || []);
  if (fs.length) {
    e.preventDefault();
    saveDialog(fs);
  } else {
    const text = e.clipboardData?.getData('text/plain');
    if (text && isHttpUrl(text)) {
      saveDialog(undefined, 'link');
      document.querySelector<HTMLInputElement>('[name=source_url]')!.value = text;
    }
  }
});
document.addEventListener('keydown', e => {
  const editing = (e.target as HTMLElement).matches('input,textarea');
  if (e.key === '/' && !editing) {
    e.preventDefault();
    document.querySelector<HTMLInputElement>('#search')?.focus();
  }
  if (!editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    run(async () => {
      const ok = e.shiftKey ? await redo() : await undo();
      if (ok) {
        await refresh();
        toast(e.shiftKey ? 'Redone' : 'Undone');
      }
    });
  }
});
async function boot() {
  try {
    await initialize();
    action({type: 'files.purge', payload: {fromSync: true}, recordHistory: false}).catch(() => {});
    await refresh();
    navigator.storage?.persist?.().catch(() => {});
    if (studioSyncOn())
      loadStudio().then(
        s => s.start(),
        () => studioHost.setStatus('Studio · can’t load studio sync: reload to try again', 'error'),
      );
    else startSync(remoteChanged);
    if ('serviceWorker' in navigator && import.meta.env.PROD)
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => toast('Offline setup failed. Reopen while online to try again.'));
  } catch (e) {
    root.innerHTML = `<div class="empty"><h1>Studio Wall could not open local storage.</h1><p>${esc((e as Error).message)}</p><p>Allow browser storage, then reload.</p></div>`;
  }
}
boot();
