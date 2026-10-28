// Back up / move devices, and Recently deleted.
import {recentlyDeleted, RETENTION_DAYS, file, action} from '../data';
import {exportLibrary} from '../backup';
import {syncNow, syncStatus} from '../sync';
import {esc} from '../text';
import {ui} from './state';
import {icon, paintIcons, show, toast, run} from './kit';
import {refresh} from './render';
import {remoteChanged, loadStudio} from './remote';
import {syncLabel} from './sync-status';

export function libraryDialog() {
  const d = show(
    `<div class="dialog-heading"><div class="eyebrow">BACK UP · MOVE DEVICES</div><h2>Your whole library</h2><p>With sync on, your boards reach your other signed-in devices automatically. You can also export everything as one file — a backup, or a way to move boards without sync. Importing adds only new or changed items; nothing on the receiving device is removed.</p></div><div class="pin-actions"><button class="primary" id="export-library">${icon('hard-drive')} Export everything</button><button id="import-library">${icon('folder-input')} Import backup or board</button></div><p class="hint">On iPhone, Export opens the Share sheet: save to Files or AirDrop it. On the other device, tap Import and pick the file. </p><p class="sync-label hint">${icon('hard-drive')} ${esc(syncLabel())}</p><div class="pin-actions"><button id="open-studio">${icon('user-round')} Studio account</button></div>${syncStatus().state === 'off' ? '' : '<p class="hint">Live sync is on: changes upload automatically and appear on your other signed-in devices within about 20 seconds. <button id="sync-now">Sync now</button></p>'}`,
  );
  d.querySelector<HTMLButtonElement>('#sync-now')?.addEventListener('click', () => run(() => syncNow(remoteChanged)));
  d.querySelector<HTMLButtonElement>('#open-studio')!.onclick = () =>
    run(async () => {
      (await loadStudio()).panel();
    });
  d.querySelector('.pin-actions')!.insertAdjacentHTML(
    'beforeend',
    `<button id="open-trash">${icon('trash-2')} Recently deleted</button>`,
  );
  paintIcons();
  d.querySelector<HTMLButtonElement>('#open-trash')!.onclick = () => {
    d.close();
    trashDialog();
  };
  d.querySelector<HTMLButtonElement>('#export-library')!.onclick = () =>
    run(async () => {
      const c = await exportLibrary();
      toast(`Exported ${c.boards} boards, ${c.pins} references`);
    });
  d.querySelector<HTMLButtonElement>('#import-library')!.onclick = () =>
    document.querySelector<HTMLInputElement>('#zip-input')!.click();
}
/** Recently deleted: restore boards or cards for RETENTION_DAYS days; after that their unused image files are removed. */
export async function trashDialog() {
  const {boards, pins} = await recentlyDeleted();
  const left = (iso: string | null) =>
    Math.max(0, Math.ceil((Date.parse(String(iso)) + RETENTION_DAYS * 86400_000 - Date.now()) / 86400_000));
  const thumbs = new Map<string, string>();
  for (const p of pins)
    if (p.file_ref) {
      const blob = await file(p.file_ref);
      if (blob) thumbs.set(p.id, URL.createObjectURL(blob));
    }
  const d =
    show(`<div class="dialog-heading"><div class="eyebrow">RECENTLY DELETED</div><h2>Bring something back</h2><p>Deleted boards and references stay here for ${RETENTION_DAYS} days, on every synced device. After that their images are removed to free space — unless another reference still uses the same image.</p></div>
 ${boards.length || pins.length ? `<div class="trash-list">${boards.map(({board, count}) => `<div class="trash-row"><div class="trash-thumb">${icon('square')}</div><div><strong>${esc(board.name)}</strong><span>Board · ${count} reference${count === 1 ? '' : 's'} · ${left(board.deleted_at)} days left</span></div><button data-restore-board="${board.id}">Restore</button></div>`).join('')}${pins.map(p => `<div class="trash-row"><div class="trash-thumb">${thumbs.get(p.id) ? `<img src="${thumbs.get(p.id)}" alt="">` : icon(p.meta.kind === 'link' ? 'link' : 'quote')}</div><div><strong>${esc(p.meta.title || p.note || p.source_url || 'Untitled reference')}</strong><span>${esc(ui.data.boards.find(b => b.id === p.board_id)?.name || 'Board deleted · returns to Inbox')}${p.deleted_by?.startsWith('guest:') ? ` · removed by ${esc(p.contributor_name || 'a client')}` : ''} · ${left(p.deleted_at)} days left</span></div><button data-restore-pin="${p.id}">Restore</button></div>`).join('')}</div>` : '<p class="hint">Nothing deleted in the last 30 days.</p>'}`);
  d.addEventListener('close', () => thumbs.forEach(u => URL.revokeObjectURL(u)), {once: true});
  d.querySelectorAll<HTMLButtonElement>('[data-restore-board],[data-restore-pin]').forEach(
    b =>
      (b.onclick = () =>
        run(async () => {
          const board = b.dataset.restoreBoard;
          await action({type: board ? 'board.restore' : 'pin.restore', id: board || b.dataset.restorePin});
          b.closest('.trash-row')!.remove();
          await refresh();
          toast(board ? 'Board restored' : 'Reference restored');
        })),
  );
}
