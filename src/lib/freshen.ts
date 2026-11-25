// Over-the-air updates. By default a phone downloads a new version in the background and only
// switches to it the next time the app is opened, so someone could use an old layout for a whole
// session. Here a new version is checked for on opening and on coming back to the app, and if one
// is found it is switched to straight away, unless a story is playing, which is never interrupted.
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

import { usePlayer } from '@/state/player';

let busy = false;

async function freshen() {
  if (busy || __DEV__ || !Updates.isEnabled) return;
  busy = true;
  try {
    const found = await Updates.checkForUpdateAsync();
    if (!found.isAvailable) return;
    await Updates.fetchUpdateAsync();
    // Mid-story the new version waits, and is picked up the next time the app is opened.
    const { phase } = usePlayer.getState();
    if (phase === 'playing' || phase === 'starting') return;
    await Updates.reloadAsync();
  } catch {
    // No connection, or nothing to fetch. The app carries on as it is.
  } finally {
    busy = false;
  }
}

/** Starts watching for new versions. Called once, when the app opens. */
export function watchForUpdates() {
  freshen();
  AppState.addEventListener('change', (state) => state === 'active' && freshen());
}
