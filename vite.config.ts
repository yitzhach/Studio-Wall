import {defineConfig} from 'vite';

// Generated once per build, so reloads show the deployed bundle's build time.
export default defineConfig({
  define: {__BUILD_TIME__: JSON.stringify(new Date().toISOString())},
});
