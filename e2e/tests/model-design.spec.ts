import { test, expect } from '@playwright/test';
import { gotoDesignTab, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('モデル設計', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await api.dispose();
  });

  test('モデル/フィールドを追加してデプロイできる', async ({ page }) => {
    await gotoDesignTab(page);

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
});
