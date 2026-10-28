// The sync line in the sidebar and the sync dot on the phone's header button: old sync, or studio sync on a device
// that switched to it (src/studio.ts reports its status through setStudioStatus).
import {syncStatus, onSyncStatus} from '../sync';
import {studioSyncOn} from '../studio-session';
import {esc} from '../text';
import {icon, paintIcons} from './kit';

type StudioState = 'off' | 'syncing' | 'on' | 'error';
let studioText = 'Studio · starting…',
  studioState: StudioState = 'syncing';
export function setStudioStatus(text: string, s: StudioState) {
  studioText = text;
  studioState = s;
  paintSync();
}
export const syncState = () => (studioSyncOn() ? studioState : syncStatus().state);
export function syncLabel() {
  if (studioSyncOn()) return studioText;
  const s = syncStatus();
  return s.state === 'off'
    ? 'Saved on this device'
    : s.state === 'syncing'
      ? 'Syncing…'
      : s.state === 'on'
        ? 'Synced online'
        : 'Sync paused — ' + (s.message || 'will retry');
}
function paintSync() {
  document.querySelectorAll<HTMLElement>('[data-action=library]').forEach(b => {
    b.dataset.sync = syncState();
    b.title = syncLabel();
  });
  document.querySelectorAll('.sync-label').forEach(el => {
    el.innerHTML = `${icon(syncState() === 'off' ? 'hard-drive' : 'arrow-left-right')} ${esc(syncLabel())}`;
  });
  paintIcons();
}
onSyncStatus(paintSync);
