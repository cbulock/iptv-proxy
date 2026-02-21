import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  root: path.resolve(__dirname),
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:34400',
      '/channels': 'http://127.0.0.1:34400',
      '/lineup': 'http://127.0.0.1:34400',
      '/xmltv.xml': 'http://127.0.0.1:34400',
      '/stream': 'http://127.0.0.1:34400',
      '/images': 'http://127.0.0.1:34400'
    }
  },
  build: {
    outDir: path.resolve(__dirname, '../public/admin'),
    emptyOutDir: true
  }
});
