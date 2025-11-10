import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  root: path.resolve(__dirname),
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:34400',
      '/channels': 'http://localhost:34400',
      '/lineup': 'http://localhost:34400',
      '/xmltv.xml': 'http://localhost:34400',
      '/stream': 'http://localhost:34400',
      '/images': 'http://localhost:34400'
    }
  },
  build: {
    outDir: path.resolve(__dirname, '../public/admin'),
    emptyOutDir: true
  }
});
