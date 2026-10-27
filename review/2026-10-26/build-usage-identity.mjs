import { build } from '../../admin/node_modules/vite/dist/node/index.js';
import vue from '../../admin/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';

// Isolated output: never rewrite the repository's tracked public/admin assets.
const source = fileURLToPath(new URL('./usage-identity/proxy-source/', import.meta.url));
await build({
  configFile: false,
  root: `${source}/admin`,
  base: '/admin/',
  plugins: [vue()],
  resolve: { alias: {
    'cindor-ui-core/register': fileURLToPath(new URL('../../admin/node_modules/cindor-ui-core/dist/register.js', import.meta.url)),
    'cindor-ui-core/styles.css': fileURLToPath(new URL('../../admin/node_modules/cindor-ui-core/src/styles.css', import.meta.url)),
    vue: fileURLToPath(new URL('../../admin/node_modules/vue/dist/vue.runtime.esm-bundler.js', import.meta.url)),
    'cindor-ui-core': fileURLToPath(new URL('../../admin/node_modules/cindor-ui-core', import.meta.url)),
    'cindor-ui-vue': fileURLToPath(new URL('../../admin/node_modules/cindor-ui-vue', import.meta.url)),
    'hls.js': fileURLToPath(new URL('../../admin/node_modules/hls.js/dist/hls.mjs', import.meta.url)),
    'mpegts.js': fileURLToPath(new URL('../../admin/node_modules/mpegts.js/dist/mpegts.js', import.meta.url)),
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
