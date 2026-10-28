// One card, opened: the large image with zoom and pan, its details form, comments and stars, and its actions.
import {bindImagePan} from '../pan';
import {openGallery} from '../viewer';
import {openMarkup, annotationOverlay} from '../markup';
import {bindTouchZoom, zoomAt, recentTouchDoubleTap} from '../zoom';
import {action, snapshot, type Pin} from '../data';
import {esc} from '../text';
import {ui, image, clientStars, starred, commentsAllowed, author} from './state';
import {icon, show, toast, run, options} from './kit';
import {chips, navigate, refresh, render} from './render';
import {transferDialog} from './boards';

export function focusPin(p: Pin) {
  const position = ui.visiblePins.findIndex(x => x.id === p.id);
  const d = show(
    `<nav class="focus-toolbar" aria-label="Reference navigation"><button id="back-board">${icon('arrow-left')} Back to board</button><div><button id="prev-pin" aria-label="Previous reference" ${position <= 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>${position + 1} / ${ui.visiblePins.length}</span><button id="next-pin" aria-label="Next reference" ${position >= ui.visiblePins.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button></div><button id="jump-comments">${icon('message-circle')} Comments</button>${!ui.client ? `<div class="quick-board-save"><select id="save-board" aria-label="Save a copy to board">${options(p.board_id)}</select><button id="quick-save-pin" class="primary">Save a copy</button></div>` : ''}</nav><div class="focus-layout"><div class="focus-image"><div class="image-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-fit">Fit</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="open-gallery">Expand gallery</button></div><div class="image-scroll">${image(p) ? `<div class="annotated-image"><img src="${image(p)}" alt="${esc(p.meta.title || 'Saved reference')}">${annotationOverlay(p.annotations || [])}</div>` : `<blockquote>${esc(p.note || p.source_url)}</blockquote>`}</div></div><div class="inspector"><div class="eyebrow">SAVED INSPIRATION</div><h2>${esc(p.meta.title || 'A reference to return to')}</h2>${chips(p)}<form id="edit-form"><label>Title<input name="title" value="${esc(p.meta.title)}"></label><label>Board<select name="board_id">${options(p.board_id)}</select></label><label>Notes<textarea name="note" rows="4">${esc(p.note)}</textarea></label><label>Tags<input name="tags" value="${esc(p.tags.join(', '))}"></label><div class="source-block"><h3>Source & credit</h3><label>Creator / source<input name="source_credit" value="${esc(p.source_credit)}"></label><label>Original link<input name="source_url" type="url" value="${esc(p.source_url)}"></label>${p.source_url ? `<a href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">View original ${icon('external-link')}</a>` : ''}<label class="checkbox"><input type="checkbox" name="is_own" ${p.is_own ? 'checked' : ''}> My own work</label></div><p class="error" role="alert"></p><button class="primary submit">Save changes</button></form><div class="pin-actions">${image(p) ? `<button id="markup-pin">${icon('pencil')} Mark up / annotate${p.annotations?.length ? ` · ${p.annotations.length}` : ''}</button>` : ''}<button id="organize-pin">${icon('panels-top-left')} Copy / move to board</button><button id="cover">${icon('image')} Use as board cover</button><button id="delete-pin" class="danger">${icon('trash-2')} Delete reference</button></div></div></div>`,
    true,
  );
  let zoom = 1;
  const zoomImage = d.querySelector<HTMLImageElement>('.image-scroll img');
  const pan = bindImagePan(d.querySelector<HTMLElement>('.image-scroll')!, () => zoom > 1);
  d.addEventListener('close', pan.end, {once: true});
  let touch: {update(): void} | null = null;
  const setZoom = () => {
    pan.update();
    touch?.update();
    if (zoomImage) {
      zoomImage.style.width = `${zoom * 100}%`;
      zoomImage.style.maxHeight = zoom === 1 ? '85dvh' : 'none';
      d.querySelector('#zoom-fit')!.textContent = zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}% · Fit`;
    }
  };
  const scroller = d.querySelector<HTMLElement>('.image-scroll')!;
  const zoomTo = (next: number, at: {x: number; y: number} | null) => {
    next = Math.min(4, Math.max(1, next));
    if (next === zoom) return;
    const from = zoom;
    zoomAt(scroller, from, next, at, () => {
      zoom = next;
      setZoom();
    });
  };
  d.querySelector<HTMLButtonElement>('#zoom-in')!.onclick = () => zoomTo(zoom + 0.25, null);
  d.querySelector<HTMLButtonElement>('#zoom-out')!.onclick = () => zoomTo(zoom - 0.25, null);
  d.querySelector<HTMLButtonElement>('#zoom-fit')!.onclick = () => zoomTo(1, null);
  d.querySelector<HTMLButtonElement>('#open-gallery')!.onclick = () => openGallery(ui.visiblePins, image, p.id);
  if (zoomImage) {
    // Double-click / double-tap opens the full-screen gallery; pinch zooms in place on touch screens.
    d.querySelector<HTMLElement>('.annotated-image')!.ondblclick = () => {
      if (!recentTouchDoubleTap()) openGallery(ui.visiblePins, image, p.id);
    };
    zoomImage.title = 'Double-click to expand';
    touch = bindTouchZoom(scroller, {
      get: () => zoom,
      set: (z, at) => zoomTo(z, at),
      doubleTap: () => openGallery(ui.visiblePins, image, p.id),
    });
  } else d.querySelector('.image-controls')!.remove();
  d.querySelector<HTMLFormElement>('form')!.onsubmit = async e => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(e.target as HTMLFormElement));
      await action({
        type: 'pin.update',
        id: p.id,
        payload: {
          ...values,
          tags: String(values.tags)
            .split(',')
            .map(t => t.trim())
            .filter(Boolean),
          is_own: values.is_own === 'on',
        },
      });
      d.close();
      await refresh();
      toast('Changes saved');
    } catch (e) {
      d.querySelector('.error')!.textContent = (e as Error).message;
    }
  };
  mountPinFeedback(d, p);
  d.querySelector<HTMLButtonElement>('#back-board')!.onclick = () => d.close();
  let dirty = false;
  d.querySelector('#edit-form')!.addEventListener('input', () => {
    dirty = true;
  });
  const step = (delta: number) => {
    const next = ui.visiblePins[position + delta];
    if (next && (!dirty || confirm('Discard unsaved edits and open the next reference?'))) focusPin(next);
  };
  d.querySelector<HTMLButtonElement>('#quick-save-pin')?.addEventListener('click', () =>
    run(async () => {
      const button = d.querySelector<HTMLButtonElement>('#quick-save-pin')!;
      button.disabled = true;
      try {
        await action({
          type: 'pin.batch',
          payload: {operation: 'copy', ids: [p.id], board_id: d.querySelector<HTMLSelectElement>('#save-board')!.value},
        });
        ui.data = await snapshot();
        toast('Copy saved to board');
      } finally {
        button.disabled = false;
      }
    }),
  );
  d.querySelector<HTMLButtonElement>('#prev-pin')!.onclick = () => step(-1);
  d.querySelector<HTMLButtonElement>('#next-pin')!.onclick = () => step(1);
  d.onkeydown = e => {
    if ((e.target as HTMLElement).closest('input,textarea,select')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  d.querySelector<HTMLButtonElement>('#jump-comments')!.onclick = () => {
    const panel = d.querySelector<HTMLElement>('.pin-feedback')!;
    panel.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
    panel.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  };

  if (ui.client) {
    d.querySelector('#edit-form')!.setAttribute('hidden', '');
    d.querySelector('.pin-actions')!.setAttribute('hidden', '');
  }
  d.querySelector('#markup-pin')?.addEventListener('click', () => {
    const src = image(p);
    if (!src) return;
    openMarkup(src, p.annotations || [], async annotations => {
      const updated = await action({type: 'pin.update', id: p.id, payload: {annotations}});
      p.annotations = updated.annotations;
      const index = ui.data.pins.findIndex(x => x.id === p.id);
      if (index >= 0) ui.data.pins[index] = updated;
    });
  });
  d.querySelector('#organize-pin')!.addEventListener('click', () => {
    d.close();
    transferDialog([p.id]);
  });
  d.querySelector('#cover')!.addEventListener('click', () =>
    run(async () => {
      await action({type: 'board.update', id: p.board_id, payload: {cover_pin_id: p.id}});
      toast('Board cover updated');
    }),
  );
  d.querySelector('#delete-pin')!.addEventListener('click', () =>
    run(async () => {
      if (confirm('Delete this reference? It will be soft-deleted from this device.')) {
        await action({type: 'pin.delete', id: p.id});
        d.close();
        await refresh();
      }
    }),
  );
  d.querySelectorAll<HTMLButtonElement>('[data-colour]').forEach(
    b =>
      (b.onclick = () => {
        ui.query = b.dataset.colour!;
        navigate('all');
        d.close();
        render();
      }),
  );
}
function mountPinFeedback(d: HTMLDialogElement, p: Pin) {
  const panel = document.createElement('section');
  panel.className = 'pin-feedback';
  d.querySelector('.inspector')!.insertBefore(panel, d.querySelector('#edit-form'));
  const draw = () => {
    const canComment = !ui.client || commentsAllowed(p.board_id);
    panel.innerHTML = `<h3>Comments</h3>${
      !ui.client && clientStars(p).length
        ? `<p class="client-starred">★ Starred by ${esc(
            clientStars(p)
              .map(f => f.author_name)
              .join(', '),
          )}</p>`
        : ''
    }<button id="star-pin" class="secondary" aria-pressed="${starred(p)}" ${canComment ? '' : 'disabled'}>${starred(p) ? '★ Starred' : '☆ Star this piece'}</button>${ui.data.feedback
      .filter(f => f.board_id === p.board_id && f.pin_id === p.id && f.text)
      .map(
        f =>
          `<article><strong>${esc(author(f))} · ${f.author_name ? 'client link' : 'this device'}</strong><p>${esc(f.text)}</p></article>`,
      )
      .join(
        '',
      )}<form id="pin-comment" ${canComment ? '' : 'hidden'}><label>Add a comment<textarea name="text" required maxlength="4000" placeholder="What do you like about this piece?"></textarea></label><button class="primary">Post comment</button></form>${canComment ? '' : '<p class="form-help">Comments are turned off for this board.</p>'}`;
    panel.querySelector<HTMLButtonElement>('#star-pin')!.onclick = () =>
      run(async () => {
        await action({type: 'feedback.star', payload: {board_id: p.board_id, pin_id: p.id}});
        ui.data = await snapshot();
        draw();
      });
    panel.querySelector<HTMLFormElement>('form')!.onsubmit = e => {
      e.preventDefault();
      run(async () => {
        const text = panel.querySelector<HTMLTextAreaElement>('textarea')!.value;
        await action({
          type: 'feedback.add',
          payload: {board_id: p.board_id, pin_id: p.id, text, client_preview: ui.client},
        });
        ui.data = await snapshot();
        draw();
      });
    };
  };
  draw();
  d.addEventListener(
    'close',
    () => {
      if (!d.open) render();
    },
    {once: true},
  );
}
