import { test, expect } from '@playwright/test';
import { gotoDesignTab, newApiContext, resetDeployedModels } from './helpers.js';

/**
 * Tier 1 ユーザビリティ機能の主要 E2E。
 *  - 下書き自動保存 → リロード → 復元バナーから復元
 *  - フィールド編集 → Ctrl+Z で取り消し → Ctrl+Shift+Z でやり直し
 *  - フィールド並び替え (↑↓)
 *  - フィールド複製
 */
test.describe('ユーザビリティ機能', () => {
  test.beforeEach(async ({ page }) => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await api.dispose();
    // 各テスト間で localStorage の下書きが混ざらないようクリア。
    // addInitScript は毎回のページロード (= 後続の page.reload() でも) に走ってしまい
    // 下書きテストで保存したばかりの draft を消してしまうので、初回 goto 後に
    // 1 回だけ evaluate でクリアする方式に変える。
    await page.goto('/');
    await page.evaluate(() => {
      try { window.localStorage.clear(); } catch {}
    });
  });

  test('下書きが localStorage に保存され、リロード後に復元できる', async ({ page }) => {
    await gotoDesignTab(page);

    await page.getByTestId('add-model').click();
    const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();
    await card.getByPlaceholder('customer').fill('temporary');
    await card.getByPlaceholder('顧客').fill('一時');

    // 下書き保存の debounce (400ms) を超えて待つ
    await page.waitForTimeout(800);

    // localStorage に保存されていることを確認
    const draft = await page.evaluate(() => window.localStorage.getItem('modeler:draft:v1'));
    expect(draft).not.toBeNull();
    expect(draft!).toContain('temporary');

    // ページリロード — 編集中の models は消えるが下書きは残る
    await page.reload();
    await page.getByRole('tab', { name: /モデル設計/ }).click();

    // 復元バナーが見える
    await expect(page.getByTestId('draft-banner')).toBeVisible();

    // 復元ボタンを押す
    await page.getByTestId('restore-draft').click();

    // フィールドが復元されている
    await expect(page.getByPlaceholder('customer')).toHaveValue('temporary');
    await expect(page.getByPlaceholder('顧客')).toHaveValue('一時');
  });

  test('Undo / Redo ボタンで編集を行き来できる', async ({ page }) => {
    await gotoDesignTab(page);

    await page.getByTestId('add-model').click();
    const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();
    await card.getByPlaceholder('customer').fill('a');

    // Undo ボタンが有効化されることを確認
    await expect(page.getByTestId('undo')).toBeEnabled();

    // Undo ボタンをクリック (ショートカット経由よりロケータが安定)
    await page.getByTestId('undo').click();
    await expect(card.getByPlaceholder('customer')).toHaveValue('');

    // Redo ボタンで戻せる
    await page.getByTestId('redo').click();
    await expect(card.getByPlaceholder('customer')).toHaveValue('a');
  });

  test('フィールドを ↓ ボタンで並び替えできる', async ({ page }) => {
    await gotoDesignTab(page);

    await page.getByTestId('add-model').click();
    const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();

    // 1 行目を name=first に変更
    const rows = card.locator('table tbody tr');
    await rows.nth(0).getByPlaceholder('e.g., email').fill('first');

    // 2 行目を追加
    await card.getByRole('button', { name: '+ フィールド追加' }).click();
    await rows.nth(1).getByPlaceholder('e.g., email').fill('second');

    // 1 行目の ↓ を押すと順序が入れ替わる
    await page.getByTestId('field-down-0').click();

    await expect(rows.nth(0).getByPlaceholder('e.g., email')).toHaveValue('second');
    await expect(rows.nth(1).getByPlaceholder('e.g., email')).toHaveValue('first');
  });

  test('フィールド複製ボタンで _copy 付きの行が増える', async ({ page }) => {
    await gotoDesignTab(page);

    await page.getByTestId('add-model').click();
    const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();
    const rows = card.locator('table tbody tr');

    await rows.nth(0).getByPlaceholder('e.g., email').fill('email');
    await page.getByTestId('field-duplicate-0').click();

    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByPlaceholder('e.g., email')).toHaveValue('email_copy');
  });

  test('不正なフィールド名はインラインエラーで指摘される', async ({ page }) => {
    await gotoDesignTab(page);

    await page.getByTestId('add-model').click();
    const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();
    const firstRow = card.locator('table tbody tr').first();
    await firstRow.getByPlaceholder('e.g., email').fill('123bad');

    await expect(page.getByTestId('field-name-error-0')).toBeVisible();
  });
});
