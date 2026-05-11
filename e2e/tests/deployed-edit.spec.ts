import { test, expect } from '@playwright/test';
import { deployCustomer, gotoUserMode, newApiContext, resetDeployedModels } from './helpers.js';

test.describe.skip('デプロイ済みモデルのインライン編集/削除', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployCustomer(api);
    await api.post('http://localhost:4000/api/customer', {
      data: { name: 'PreExisting', age: 50 },
    });
    await api.dispose();
  });

  test('フィールド追加してもデータが保持される', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await page.getByTestId('edit-deployed').click();
    await expect(page.getByTestId('inline-model-editor')).toBeVisible();

    // フィールド追加: 編集領域内のボタンをクリック
    const editor = page.getByTestId('inline-model-editor');
    await editor.getByRole('button', { name: '+ フィールド追加' }).click();

    // 末尾の新しい行に email を入力
    const lastNameInput = editor.getByPlaceholder('e.g., email').last();
    await lastNameInput.fill('email');
    const lastLabelInput = editor.getByPlaceholder('e.g., メール').last();
    await lastLabelInput.fill('メール');

    await page.getByTestId('save-inline-edit').click();
    await expect(page.getByTestId('inline-model-editor')).toBeHidden();

    // 既存データが残っているか
    await expect(page.getByRole('cell', { name: 'PreExisting', exact: true })).toBeVisible();
    // 新カラム (メール) が表示されているか
    await expect(page.getByRole('columnheader', { name: 'メール' })).toBeVisible();
  });

  test('モデル削除すると一覧から消える', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await page.getByTestId('delete-deployed').click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-ok').click();

    await expect(page.getByText('デプロイされたモデルがありません').first()).toBeVisible();
  });
});
