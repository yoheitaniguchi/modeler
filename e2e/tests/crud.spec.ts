import { test, expect } from '@playwright/test';
import { deployCustomer, gotoUserMode, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('CRUD 画面', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployCustomer(api);
    await api.dispose();
  });

  test('レコードの作成・編集・削除ができる', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await expect(page.getByTestId('crud-title')).toBeVisible();

    // 作成
    await page.getByTestId('create-button').click();
    await page.getByPlaceholder('氏名 *').fill('Alice');
    await page.getByPlaceholder('年齢').fill('30');
    await page.getByTestId('modal-save-and-close').click();
    await expect(page.getByRole('cell', { name: 'Alice', exact: true })).toBeVisible();

    // 編集
    const aliceRow = page.getByRole('row').filter({ hasText: 'Alice' });
    await aliceRow.getByRole('button', { name: '更新' }).click();
    const nameInput = page.getByPlaceholder('氏名 *');
    await nameInput.fill('AliceUpdated');
    await page.getByTestId('modal-save-and-close').click();
    await expect(page.getByRole('cell', { name: 'AliceUpdated', exact: true })).toBeVisible();

    // 削除
    const updatedRow = page.getByRole('row').filter({ hasText: 'AliceUpdated' });
    await updatedRow.getByRole('button', { name: '削除' }).click();
    await expect(page.getByRole('cell', { name: 'AliceUpdated', exact: true })).toHaveCount(0);
  });
});
