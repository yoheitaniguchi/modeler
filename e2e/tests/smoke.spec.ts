import { test, expect } from '@playwright/test';

/**
 * 最小スモークテスト。
 *  - サーバーが起動している
 *  - SPA の HTML が返る
 *  - React がマウントできる (タブが描画される)
 * これが失敗するなら、テストロジックではなく環境 (server/build/proxy) の問題。
 */
test('smoke: page loads and renders the design tab', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    errors.push(`requestfailed: ${req.method()} ${req.url()} -> ${req.failure()?.errorText}`);
  });

  const res = await page.goto('/');
  expect(res?.status(), `goto / status. errors=${errors.join('|')}`).toBe(200);

  // h1 が見えれば SPA が起動している
  await expect(page.getByRole('heading', { level: 1, name: /Modeler/ })).toBeVisible({ timeout: 15_000 });

  // 設計タブも見える
  await expect(page.getByRole('tab', { name: /モデル設計/ })).toBeVisible();

  // ページエラー無し
  expect(errors, `unexpected errors: ${errors.join('\n')}`).toEqual([]);
});
