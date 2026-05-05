import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Playwright 設定。
 *
 *  - 本番ビルドした client を server (Express) が同一ポートで配信する構成
 *    → port 4000 の単一サーバーで完結。CI 安定性を優先。
 *  - 各テストはサーバーをまっさらな状態で開始したいので
 *    MODELER_DATA_DIR を専用ディレクトリにする。
 *  - CI ではリトライ + アーティファクト (trace, screenshot, video) を保存。
 *  - ブラウザは chromium / firefox / webkit の 3 種をマトリクスで実行。
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : 'list',
  // 個々のテストはせいぜい数秒〜10秒程度で終わるはず
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:4000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    // 本番ビルドした成果物を起動 (npm start は dist/index.js を node で実行)
    command: 'npm start --workspace=@modeler/server',
    cwd: repoRoot,
    url: 'http://localhost:4000/health',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // 起動失敗時に CI ログから原因を追えるよう、webServer の出力を継承する
    // (Playwright の stdout/stderr 設定は piped でも process.stdout に流れるが、
    //  ここでは pipe を維持し、テスト失敗時のみ詳細が出るようにする)
    env: {
      ...process.env,
      MODELER_DATA_DIR: path.join(repoRoot, 'e2e', '.e2e-data'),
      CLIENT_DIST_DIR: path.join(repoRoot, 'client', 'dist'),
      PORT: '4000',
      NODE_ENV: 'production',
    },
    timeout: 120_000,
  },
});
