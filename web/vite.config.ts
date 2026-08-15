import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3210', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3210', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 不清空旧版 hash 资源：浏览器若缓存了旧 index.html 也能加载对应文件，避免 404 白屏
    emptyOutDir: false,
  },
});
