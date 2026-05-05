import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Playwright 設定。
 *
 *  - webServer で server (Express) と client (Vite) を自動起動
 *  - 各テストに新規データディレクトリを切るため、サーバーは MODELER_DATA_DIR=./e2e-data
 *  - CI ではリトライ + アーティファクト (trace, screenshot, video) を保存
 *  - ブラウザは chromium / firefox / webkit の 3 種をマトリクスで実行
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // サーバー側の DAO 状態を共有するため直列実行
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: [
    {
      command: 'npm run dev:server',
      cwd: repoRoot,
      port: 4000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        MODELER_DATA_DIR: path.join(repoRoot, 'e2e', '.e2e-data'),
        PORT: '4000',
      },
      timeout: 60_000,
    },
    {
      command: 'npm run dev:client',
      cwd: repoRoot,
      port: 5173,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    },
  ],
});
