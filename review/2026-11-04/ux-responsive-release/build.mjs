// Run from repository root. Never writes to tracked public/admin assets.
import { build } from '../../../admin/node_modules/vite/dist/node/index.js';
import vue from '../../../admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';
const local = path => fileURLToPath(new URL(path, import.meta.url));
const dependencies = '../../../admin/node_modules/';
await build({
  configFile: false,
  root: local('./source/admin/'),
  base: '/admin/',
  plugins: [vue()],
  resolve: {
    alias: {
      'cindor-ui-core/register': local(dependencies + 'cindor-ui-core/dist/register.js'),
      'cindor-ui-core/styles.css': local(dependencies + 'cindor-ui-core/src/styles.css'),
      vue: local(dependencies + 'vue/dist/vue.runtime.esm-bundler.js'),
      'cindor-ui-core': local(dependencies + 'cindor-ui-core'),
      'cindor-ui-vue': local(dependencies + 'cindor-ui-vue'),
      'hls.js': local(dependencies + 'hls.js/dist/hls.mjs'),
      'mpegts.js': local(dependencies + 'mpegts.js/dist/mpegts.js'),
    },
  },
  build: {
    outDir: local('./public/admin/'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: info =>
          info.name?.endsWith('.css') ? 'assets/index.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
