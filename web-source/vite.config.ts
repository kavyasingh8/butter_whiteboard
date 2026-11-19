import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  // The UI imports its English strings from ../locales/en.json.
  server: { fs: { allow: ['..'] } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // FiveM's NUI runs an older embedded Chromium.
    target: 'chrome103',
    cssTarget: 'chrome103',
    outDir: '../web',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      // dui.html is the page drawn onto the props, it shares the renderer with the editor.
      input: { index: page('index.html'), dui: page('dui.html') },
    },
  },
});
