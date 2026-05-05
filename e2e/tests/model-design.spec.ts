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
    // 1 つ目のモデル入力
    await page.getByPlaceholder('customer').first().fill('product');
    await page.getByPlaceholder('顧客').first().fill('商品');
    // 1 つ目のフィールドを埋める
    await page.getByPlaceholder('e.g., email').first().fill('title');
    await page.getByPlaceholder('e.g., メール').first().fill('タイトル');

    await page.getByTestId('deploy').click();
    await expect(page.locator('.notice')).toContainText('デプロイ');
  });
});
