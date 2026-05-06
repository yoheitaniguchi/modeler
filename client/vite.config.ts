/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite + Vitest を 1 ファイルに同居。
 * proxy でフロントの /api と /meta をローカル Express にそのまま流す。
 * → CORS や baseURL の切替が要らずシンプル。
 */
// base は GitHub Pages 配信時のサブパス。
// 本番デプロイ (deploy.yml) ではデフォルトの '/modeler/' を使い、
// E2E では root '/' から配信したいので VITE_BASE で上書きできるようにする。
export default defineConfig({
  base: '',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/meta': 'http://localhost:4000',
      '/test': 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.ts',
  },
});
