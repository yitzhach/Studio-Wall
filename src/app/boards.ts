// Boards: create and edit, share with clients, copy or move cards between boards, and the sample demo boards.
import {action, type Board} from '../data';
import {palette} from '../media';
import {exportBoard} from '../backup';
import {syncNow, syncStatus, listShares, createShare, revokeShare, shareUrl, type Permission} from '../sync';
import {studioSyncOn} from '../studio-session';
import {esc} from '../text';
import {ui, boardNow, selection} from './state';
import {icon, paintIcons, show, toast, run, options} from './kit';
import {navigate, refresh, render} from './render';
import {remoteChanged} from './remote';

export function boardDialog(board?: Board) {
  const d = show(
    `<div class="dialog-heading"><div class="eyebrow">A PLACE FOR YOUR IDEAS</div><h2>${board ? 'Edit board' : 'Create a board'}</h2></div><form><label>Name<input name="name" required maxlength="100" value="${esc(board?.name)}" placeholder="e.g. A quieter kind of blue"></label><label>Description<textarea name="description" placeholder="What are we exploring?">${esc(board?.description)}</textarea></label><p class="error" role="alert"></p><button class="primary submit">${board ? 'Save changes' : 'Create board'}</button></form>${board ? '<div class="pin-actions"><button id="export-board">Export board ZIP</button><button class="danger" id="delete-board">Delete board</button></div>' : ''}`,
  );
  d.querySelector<HTMLFormElement>('form')!.onsubmit = async e => {
    e.preventDefault();
    try {
      const b = await action({
        type: board ? 'board.update' : 'board.create',
        id: board?.id,
        payload: Object.fromEntries(new FormData(e.target as HTMLFormElement)),
      });
      ui.view = b.id;
      d.close();
      await refresh();
    } catch (e) {
      d.querySelector('.error')!.textContent = (e as Error).message;
    }
  };
  if (board) {
    d.querySelector('#export-board')!.addEventListener('click', () => run(() => exportBoard(board)));
    d.querySelector('#delete-board')!.addEventListener('click', () =>
      run(async () => {
        if (confirm('Delete this board and its references from this device?')) {
          await action({type: 'board.delete', id: board.id});
          ui.view = 'all';
          d.close();
          await refresh();
        }
      }),
    );
  }
}
export function shareDialog(only: string[] = []) {
  const board = boardNow()!;
  const n = only.length,
    cards = `${n} card${n === 1 ? '' : 's'}`;
  const settings = board.share_settings || {mode: 'private', permission: 'comment'};
  const online = !studioSyncOn() && syncStatus().state !== 'off';
  const d =
    show(`<div class="dialog-heading"><div class="eyebrow">SHARE WITH A CLIENT</div><h2>${n ? `Send ${cards} from “${esc(board.name)}”` : `Send “${esc(board.name)}”`}</h2><p>${n ? `This link opens only the ${cards} you selected: their images, titles and credits. The rest of the board, your image notes, tags and other boards stay private.` : 'A client link opens this board only: its images, titles and credits. Your image notes, tags and other boards stay private.'} Links can expire, and you can turn one off at any time.</p></div>
 ${online ? `<form id="new-link"><div class="form-row"><label>Client can<select name="permission"><option value="comment">View, star and comment</option><option value="contribute">View, comment and add cards</option><option value="view">View only</option></select></label><label>Link expires<select name="expires"><option value="30">In 30 days</option><option value="7">In 7 days</option><option value="90">In 90 days</option><option value="0">Never</option></select></label></div><label>Password<input name="password" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" minlength="8" maxlength="200" placeholder="Optional · at least 8 characters"></label><p class="form-help">Clients type it once on each device. Send it separately from the link (say, by text). It can’t be shown again.</p><p class="error" role="alert"></p><button class="primary">${icon('link')} ${n ? `Create link for ${cards}` : 'Create client link'}</button></form><div id="link-list" class="link-list"><p class="hint">Loading links…</p></div>` : studioSyncOn() ? `<p class="notice">Client links still run on old sync, and this device uses studio sync. To make or change links here, switch back to old sync in Studio account (they move to the studio in a later stage).</p>` : `<p class="notice">Client links need sync. Open Studio Wall at its web address and sign in; once the footer says “Synced online”, you can create links here.</p>`}
 <label class="checkbox"><input type="checkbox" name="comments_enabled" ${board.comments_enabled !== false ? 'checked' : ''}> Allow client comments, stars and added cards on this board</label><p class="form-help">Turning this off makes every link view only. Existing feedback and cards are kept.</p>
 <details class="local-preview"><summary>Preview the client view on this device</summary><form id="share-settings"><label>Preview as a client who can<select name="permission"><option value="view">View references</option><option value="comment">View and comment</option><option value="contribute">View, comment and add references</option></select></label><p class="form-help">This preview is only on this device. For a real client, create a link above.</p><button class="secondary" id="client-preview" type="button">Open client preview</button></form></details>`);
  const permission = d.querySelector<HTMLSelectElement>('#share-settings [name=permission]')!;
  permission.value = settings.permission;
  const comments = d.querySelector<HTMLInputElement>('[name=comments_enabled]')!;
  comments.onchange = () =>
    run(async () => {
      await action({type: 'board.update', id: board.id, payload: {comments_enabled: comments.checked}});
      toast(comments.checked ? 'Client comments on' : 'Links are now view only');
    });
  d.querySelector('#client-preview')!.addEventListener('click', () =>
    run(async () => {
      await action({
        type: 'board.share_settings',
        id: board.id,
        payload: {mode: settings.mode, permission: permission.value},
      });
      await action({type: 'board.update', id: board.id, payload: {comments_enabled: comments.checked}});
      d.close();
      await refresh();
      ui.client = true;
      render();
    }),
  );
  if (!online) return;
  const list = d.querySelector<HTMLElement>('#link-list')!;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'never';
  const share = async (url: string) => {
    try {
      if (navigator.share && matchMedia('(pointer:coarse)').matches) {
        await navigator.share({title: board.name, url});
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      prompt('Copy this link', url);
    }
  };
  const draw = async () => {
    try {
      const links = (await listShares()).filter(x => x.board_id === board.id);
      list.innerHTML = links.length
        ? links
            .map(
              x =>
                `<div class="link-row"><div><strong>${x.permission === 'contribute' ? 'View, comment and add cards' : x.permission === 'comment' ? 'View, star and comment' : 'View only'}</strong><span>${x.pin_count ? `${x.pin_count} selected card${x.pin_count === 1 ? '' : 's'} · ` : ''}${x.locked ? 'Password · ' : ''}Created ${when(x.created_at)} · expires ${when(x.expires_at)}</span></div><button data-copy="${x.token}">${icon('link')} ${'share' in navigator && matchMedia('(pointer:coarse)').matches ? 'Share' : 'Copy'}</button><button class="danger" data-revoke="${x.token}">Turn off</button></div>`,
            )
            .join('')
        : '<p class="hint">No active links for this board.</p>';
      paintIcons();
      list
        .querySelectorAll<HTMLButtonElement>('[data-copy]')
        .forEach(b => (b.onclick = () => share(shareUrl(b.dataset.copy!))));
      list.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach(
        b =>
          (b.onclick = () =>
            run(async () => {
              if (!confirm('Turn off this link? Anyone using it will lose access.')) return;
              await revokeShare(b.dataset.revoke!);
              toast('Link turned off');
              await draw();
            })),
      );
    } catch (e) {
      list.innerHTML = `<p class="error">${esc((e as Error).message)}</p>`;
    }
  };
  d.querySelector<HTMLFormElement>('#new-link')!.onsubmit = async e => {
    e.preventDefault();
    const f = e.target as HTMLFormElement,
      btn = f.querySelector('button')!;
    btn.disabled = true;
    try {
      await syncNow(remoteChanged);
      const v = Object.fromEntries(new FormData(f));
      const x = await createShare(
        board.id,
        v.permission as Permission,
        Number(v.expires),
        String(v.password || ''),
        only,
      );
      f.reset();
      await draw();
      await share(shareUrl(x.token));
    } catch (err) {
      f.querySelector('.error')!.textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
    }
  };
  draw();
}
export function transferDialog(ids: string[], target?: string) {
  const d = show(
    `<div class="dialog-heading"><div class="eyebrow">BUILD A MOOD BOARD</div><h2>Organize ${ids.length} reference${ids.length === 1 ? '' : 's'}</h2><p>Copy keeps the originals. Move takes them out of their current boards.</p></div><form><label>Action<select name="operation"><option value="copy">Copy to board</option><option value="move">Move to board</option></select></label><label>Destination<select name="board_id">${options(target || boardNow()?.id)}</select></label><label>Or create a new board<input name="new_board_name" placeholder="e.g. Client · Living room"></label><p class="form-help">A new board name overrides the destination above. Credits and image data are preserved.</p><p class="error" role="alert"></p><button class="primary">Apply</button></form>`,
  );
  d.querySelector<HTMLFormElement>('form')!.onsubmit = async e => {
    e.preventDefault();
    const button = d.querySelector<HTMLButtonElement>('form button')!;
    button.disabled = true;
    try {
      const result = await action({
        type: 'pin.batch',
        payload: {...Object.fromEntries(new FormData(e.target as HTMLFormElement)), ids},
      });
      selection.clear();
      ui.selecting = false;
      navigate(result.id, true, false);
      ui.selectionAnchor = null;
      d.close();
      await refresh();
      toast('References added to board');
    } catch (e) {
      d.querySelector('.error')!.textContent = (e as Error).message;
      button.disabled = false;
    }
  };
}
export async function sample() {
  const existing = ui.data.boards.find(b => b.name === 'A quieter kind of blue');
  if (existing) {
    navigate(existing.id, true, false);
    await refresh();
    toast('Select references, then copy to a client board.');
    return;
  }
  const response = await fetch('/sample-plaster.webp');
  if (!response.ok) throw Error('Sample image is not available offline yet.');
  const sampleBlob = await response.blob();
  const b = await action({
    type: 'board.create',
    payload: {
      name: 'A quieter kind of blue',
      description: 'A sample direction: weathered surfaces, soft colour, and traces of warmth.',
    },
  });
  await action({
    type: 'pin.save',
    blob: sampleBlob,
    payload: {
      board_id: b.id,
      title: 'Layers of colour',
      note: 'Illustrative sample image generated for Studio Wall.',
      source_credit: 'AI-generated sample',
      is_own: false,
      palette: await palette(sampleBlob),
      tags: ['blue', 'plaster', 'texture'],
    },
  });
  await action({
    type: 'pin.save',
    payload: {
      board_id: b.id,
      title: 'The starting point',
      note: 'Try a pale blue wash over warm plaster. Let the lower layer show through.',
      tags: ['blue', 'plaster', 'texture'],
      is_own: true,
    },
  });
  await action({
    type: 'pin.save',
    payload: {
      board_id: b.id,
      title: 'A question for the room',
      note: 'Could this feel calm from a distance, but reveal more texture when you come closer?',
      tags: ['direction'],
      is_own: true,
    },
  });
  const demo = await action({
    type: 'board.create',
    payload: {
      name: 'Client · Living room',
      description: 'Demo client mood board. Copy references here, then try Collaborate.',
    },
  });
  await action({type: 'board.share_settings', id: demo.id, payload: {mode: 'private', permission: 'contribute'}});
  navigate(b.id, true, false);
  await refresh();
  toast('Demo ready. Select references and copy to Client · Living room.');
}
