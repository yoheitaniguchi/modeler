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
// Docker環境ではサービス名、ローカル開発ではlocalhostにプロキシする
const apiServer = process.env.VITE_API_SERVER ?? 'http://localhost:4000';

export default defineConfig({
  base: '',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': apiServer,
      '/meta': apiServer,
      '/test': apiServer,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.ts',
  },
});
