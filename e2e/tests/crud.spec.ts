import { test, expect } from '@playwright/test';
import { deployCustomer, gotoDeployedTab, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('CRUD 画面', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployCustomer(api);
    await api.dispose();
  });

  test('レコードの作成・編集・削除ができる', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    // 作成
    await page.getByPlaceholder('氏名').fill('Alice');
    await page.getByPlaceholder('年齢').fill('30');
    await page.getByTestId('submit-form').click();
    await expect(page.getByRole('cell', { name: 'Alice' })).toBeVisible();

    // 編集
    await page.getByRole('row', { name: /Alice/ }).getByRole('button', { name: '編集' }).click();
    await page.getByPlaceholder('氏名').fill('Alice Updated');
    await page.getByTestId('submit-form').click();
    await expect(page.getByRole('cell', { name: 'Alice Updated' })).toBeVisible();

    // 削除
    await page.getByRole('row', { name: /Alice Updated/ }).getByRole('button', { name: '削除' }).click();
    await expect(page.getByRole('cell', { name: 'Alice Updated' })).toHaveCount(0);
  });
});
