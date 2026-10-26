import {defineConfig} from 'vitest/config';
import {configDefaults} from 'vitest/config';

// Generated once per build, so reloads show the deployed bundle's build time.
// Two pages: the artist's app (index.html) and the client share page (share.html, served by the Worker at /s/<token>).
export default defineConfig({
  define: {__BUILD_TIME__: JSON.stringify(new Date().toISOString())},
  build: {rollupOptions: {input: {main: 'index.html', share: 'share.html'}}},
  // CI checks the studio platform out into .studio-platform (for the two-device run); its tests aren't ours.
  test: {exclude: [...configDefaults.exclude, '.studio-platform/**']},
});
