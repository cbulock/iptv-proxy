import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminDevPort = parseInt(process.env.ADMIN_DEV_PORT || '5173', 10);

export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  root: path.resolve(__dirname),
  server: {
    port: adminDevPort,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:34400',
      '/channels': 'http://127.0.0.1:34400',
      '/lineup': 'http://127.0.0.1:34400',
      '/xmltv.xml': 'http://127.0.0.1:34400',
      '/stream': 'http://127.0.0.1:34400',
      '/transcode': 'http://127.0.0.1:34400',
      '/images': 'http://127.0.0.1:34400',
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../public/admin'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: assetInfo => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'assets/index.css';
          }

          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
