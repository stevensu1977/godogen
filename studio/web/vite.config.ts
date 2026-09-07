import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mockApiPlugin } from './mock/plugin';

const MOCK = process.env.STUDIO_MOCK === '1';

export default defineConfig({
  plugins: [react(), ...(MOCK ? [mockApiPlugin()] : [])],
  server: {
    port: 5173,
    strictPort: true,
    proxy: MOCK
      ? undefined
      : {
          '/api': { target: 'http://localhost:4700', changeOrigin: true },
        },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
