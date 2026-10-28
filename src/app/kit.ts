// Small pieces every part of the owner app uses: icons, toasts, error reporting and the one dialog.
import {
  createIcons,
  LayoutGrid,
  Inbox,
  PanelsTopLeft,
  Plus,
  Square,
  FolderInput,
  Sun,
  Moon,
  HardDrive,
  Eye,
  Lock,
  Ellipsis,
  Users,
  Search,
  ImagePlus,
  Quote,
  Link,
  ArrowLeft,
  X,
  Camera,
  ExternalLink,
  Image as ImageIcon,
  Trash2,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Redo2,
  Pencil,
  StickyNote,
  ArrowLeftRight,
  UserRound,
} from 'lucide';
const icons = {
  LayoutGrid,
  Inbox,
  PanelsTopLeft,
  Plus,
  Square,
  FolderInput,
  Sun,
  Moon,
  HardDrive,
  Eye,
  Lock,
  Ellipsis,
  Users,
  Search,
  ImagePlus,
  Quote,
  Link,
  ArrowLeft,
  X,
  Camera,
  ExternalLink,
  Image: ImageIcon,
  Trash2,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Redo2,
  Pencil,
  StickyNote,
  ArrowLeftRight,
  UserRound,
};
import {esc} from '../text';
import {ui} from './state';

export const icon = (s: string) => `<i data-lucide="${s}"></i>`;
/** Turns every <i data-lucide> on the page into its icon. */
export const paintIcons = () => createIcons({icons});

export function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.role = 'status';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
}
/** Runs fn and shows any error it throws as a toast. */
export async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    toast((e as Error).message || 'Something went wrong. Please try again.');
  }
}
/** Opens the one dialog (#modal) with this content and a close button. */
export function show(content: string, wide = false) {
  const d = document.querySelector<HTMLDialogElement>('#modal')!;
  d.className = wide ? 'wide' : '';
  d.innerHTML = `<button class="close" aria-label="Close">${icon('x')}</button>${content}`;
  d.querySelector('.close')!.addEventListener('click', () => d.close());
  d.onclick = e => {
    if (e.target === d) d.close();
  };
  d.showModal();
  paintIcons();
  return d;
}
/** <option>s for every board, with id chosen. */
export function options(id?: string) {
  return ui.data.boards
    .map(b => `<option value="${b.id}" ${id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`)
    .join('');
}
