import {defineConfig} from 'vite';

// Generated once per build, so reloads show the deployed bundle's build time.
// Two pages: the artist's app (index.html) and the client share page (share.html, served by the Worker at /s/<token>).
export default defineConfig({
  define: {__BUILD_TIME__: JSON.stringify(new Date().toISOString())},
  build: {rollupOptions: {input: {main: 'index.html', share: 'share.html'}}},
});
