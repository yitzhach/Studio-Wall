// Adding cards: the quick "what are you adding?" choice and the save dialog for images, notes and links.
import {action} from '../data';
import {palette, optimizeImage, IMAGE_ACCEPT} from '../media';
import {esc} from '../text';
import {ui, boardNow} from './state';
import {icon, paintIcons, show, toast, options} from './kit';
import {navigate, refresh} from './render';

let picked: File | undefined;
export function quickAddDialog() {
  const d = show(
    `<div class="dialog-heading"><div class="eyebrow">ADD TO THIS BOARD</div><h2>What are you adding?</h2><p>Keep it fast — an image, a standalone note, or a useful link.</p></div><div class="quick-add"><button data-kind="image">${icon('image-plus')}<strong>Image / photo</strong><span>Upload, camera, drag or paste</span></button><button data-kind="idea">${icon('sticky-note')}<strong>Note / idea</strong><span>Add a thought directly to the board</span></button><button data-kind="link">${icon('link')}<strong>Link</strong><span>Save a URL with an optional note</span></button></div>`,
  );
  d.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(
    b =>
      (b.onclick = () => {
        const kind = b.dataset.kind as 'image' | 'idea' | 'link';
        d.close();
        saveDialog(undefined, kind);
      }),
  );
}
export function saveDialog(files?: File[], mode: 'image' | 'idea' | 'link' = 'image') {
  picked = files?.[0];
  if (files?.length) mode = 'image';
  const title =
    mode === 'idea'
      ? 'Add a note or idea'
      : mode === 'link'
        ? 'Save a link'
        : ui.client
          ? 'Add a reference'
          : 'Add images';
  const imageFields =
    mode === 'image'
      ? `<label class="upload-zone" for="upload">${icon('image-plus')}<strong id="picked-name">${esc(picked?.name || 'Choose images or drop them here')}</strong><span>JPEG, PNG, WebP, HEIC, AVIF, GIF, TIFF · optimized to WebP, max 2400px</span></label><input id="upload" type="file" accept="${IMAGE_ACCEPT}" multiple hidden><label class="camera-button">${icon('camera')} Take a photo<input id="camera" type="file" accept="image/*" capture="environment" hidden></label>`
      : '';
  const linkField =
    mode === 'link'
      ? '<label>Link<input name="source_url" type="url" required placeholder="https://…"></label>'
      : mode === 'image'
        ? '<label>Original link <span>optional</span><input name="source_url" type="url" placeholder="https://…"></label>'
        : '';
  const noteLabel = mode === 'idea' ? 'Note / idea' : 'Note';
  const d = show(
    `<div class="dialog-heading"><div class="eyebrow">KEEP SOMETHING GOOD</div><h2>${title}</h2><p>${mode === 'idea' ? 'This becomes its own card in the board — no image required.' : mode === 'link' ? 'Save a reference now and come back to it later.' : 'Add one image or a batch.'}</p></div><form id="save-form">${imageFields}<div class="form-row"><label>Title <span>optional</span><input name="title" placeholder="${mode === 'idea' ? 'Short heading' : 'What caught your eye?'}"></label><label>Board<select name="board_id">${options(boardNow()?.id || ui.data.boards.find(b => b.name === 'Inbox')?.id)}</select></label></div>${linkField}<label>${noteLabel}<textarea name="note" rows="4" ${mode === 'idea' ? 'required' : ''} placeholder="${mode === 'idea' ? 'Write the thought you want to keep on this board…' : 'A color, texture, direction, or context…'}"></textarea></label><div class="form-row"><label>Source / creator credit<input name="source_credit" placeholder="Who made or shared it?"></label><label>Tags<input name="tags" placeholder="plaster, warm tones, sculpture"></label></div><label class="checkbox"><input type="checkbox" name="is_own"> This is my own work / note</label><p class="form-help">Notes and links live in the board just like images and can be moved, copied, searched, selected, or shared later.</p><p class="error" role="alert"></p><button class="primary submit">${icon('plus')} Add to board</button></form>`,
  );
  let batch = files || [];
  for (const id of ['upload', 'camera'])
    d.querySelector<HTMLInputElement>('#' + id)?.addEventListener('change', e => {
      batch = Array.from((e.target as HTMLInputElement).files || []);
      d.querySelector('#picked-name')!.textContent =
        batch.length > 1 ? `${batch.length} images selected` : batch[0]?.name || 'Choose images';
    });
  d.querySelector<HTMLFormElement>('form')!.onsubmit = async e => {
    e.preventDefault();
    const form = e.target as HTMLFormElement,
      submit = form.querySelector<HTMLButtonElement>('.submit')!;
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      const payload = {
        ...values,
        is_own: values.is_own === 'on',
        tags: String(values.tags || '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean),
      }; // Prepare every image first, then save them in one step, so a failure part-way leaves nothing half-added.
      const items: any[] = [],
        blobs: Record<string, Blob> = {};
      const sources = batch.length ? batch : [undefined];
      for (const [i, source] of sources.entries()) {
        if (source && source.size > 50 * 1024 * 1024) throw Error('Please use images smaller than 50 MB.');
        if (sources.length > 1) submit.textContent = `Preparing ${i + 1} of ${sources.length}…`;
        const blob = source ? await optimizeImage(source) : undefined;
        if (blob) blobs[String(i)] = blob;
        items.push({...payload, palette: blob ? await palette(blob) : []});
      }
      await action({type: 'pin.save_batch', payload: {items}, blobs});
      navigate(String(values.board_id), true, false);
      d.close();
      await refresh();
      toast(mode === 'idea' ? 'Note added to board' : mode === 'link' ? 'Link added to board' : 'Saved to your board');
    } catch (e) {
      d.querySelector('.error')!.textContent = (e as Error).message;
    } finally {
      submit.disabled = false;
      submit.innerHTML = `${icon('plus')} Add to board`;
      paintIcons();
    }
  };
}
