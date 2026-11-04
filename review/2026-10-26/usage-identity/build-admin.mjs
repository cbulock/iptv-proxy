import { build } from './source/admin/node_modules/vite/dist/node/index.js';
import vue from './source/admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';

// Run from the release root. The tracked public/admin files in the checkout stay untouched.
const source = fileURLToPath(new URL('./source/', import.meta.url));
const dependency = path => fileURLToPath(new URL(`./source/admin/node_modules/${path}`, import.meta.url));

await build({
  configFile: false,
  root: `${source}/admin`,
  base: '/admin/',
  plugins: [vue()],
  resolve: { alias: {
    'cindor-ui-core/register': dependency('cindor-ui-core/dist/register.js'),
    'cindor-ui-core/styles.css': dependency('cindor-ui-core/src/styles.css'),
    vue: dependency('vue/dist/vue.runtime.esm-bundler.js'),
    'cindor-ui-core': dependency('cindor-ui-core'),
    'cindor-ui-vue': dependency('cindor-ui-vue'),
    'hls.js': dependency('hls.js/dist/hls.mjs'),
    'mpegts.js': dependency('mpegts.js/dist/mpegts.js'),
  } },
  build: {
    outDir: `${source}/public/admin`,
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: { output: {
      entryFileNames: 'assets/index.js',
      chunkFileNames: 'assets/[name].js',
      assetFileNames: info => info.name?.endsWith('.css') ? 'assets/index.css' : 'assets/[name]-[hash][extname]',
    } },
  },
});
