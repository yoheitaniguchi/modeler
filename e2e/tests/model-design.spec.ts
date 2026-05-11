import { test, expect } from '@playwright/test';
import { gotoAdminMode, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('モデル設計', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await api.dispose();
  });

  test('モデル/フィールドを追加してデプロイできる', async ({ page }) => {
    await gotoAdminMode(page);

    await page.getByTestId('add-model').click();
    // モデルカードが現れるまで待つ
    const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();
    await expect(card).toBeVisible();

    await card.getByPlaceholder('customer').fill('product');
    await card.getByPlaceholder('顧客').fill('商品');
    await card.getByPlaceholder('e.g., email').fill('title');
    await card.getByPlaceholder('e.g., メール').fill('タイトル');

    await page.getByTestId('deploy').click();
    await expect(page.locator('.notice')).toContainText('デプロイ');
  });

  test('サイドバーのケバブメニューでモデル順を入れ替えできる', async ({ page }) => {
    await gotoAdminMode(page);

    // 3 つモデルを追加 (alpha → beta → gamma)
    for (const [name, label] of [['alpha', 'A'], ['beta', 'B'], ['gamma', 'G']]) {
      await page.getByTestId('add-model').click();
      const card = page.locator('.card').filter({ hasText: 'モデル名' }).first();
      await card.getByPlaceholder('customer').fill(name);
      await card.getByPlaceholder('顧客').fill(label);
    }

    const list = page.getByTestId('model-list');
    const items = list.locator('li');
    await expect(items).toHaveCount(3);

    // 期待順序: alpha, beta, gamma
    await expect(items.nth(0).getByTestId('model-link-alpha')).toBeVisible();
    await expect(items.nth(1).getByTestId('model-link-beta')).toBeVisible();
    await expect(items.nth(2).getByTestId('model-link-gamma')).toBeVisible();

    // alpha (先頭) のケバブを開いて「下へ」
    await page.getByTestId('model-row-kebab-alpha').click();
    await expect(page.getByTestId('action-move-up')).toBeDisabled();
    await page.getByTestId('action-move-down').click();

    // 並びが beta, alpha, gamma に
    await expect(items.nth(0).getByTestId('model-link-beta')).toBeVisible();
    await expect(items.nth(1).getByTestId('model-link-alpha')).toBeVisible();
    await expect(items.nth(2).getByTestId('model-link-gamma')).toBeVisible();

    // 末尾 gamma の「下へ」は disable
    await page.getByTestId('model-row-kebab-gamma').click();
    await expect(page.getByTestId('action-move-down')).toBeDisabled();

    // 並び順注意書きが表示されている
    await expect(page.getByTestId('reorder-hint')).toBeVisible();

    // undo で 1 つ前 (alpha が再び先頭) に戻る
    await page.getByTestId('undo').click();
    await expect(items.nth(0).getByTestId('model-link-alpha')).toBeVisible();
  });
});
