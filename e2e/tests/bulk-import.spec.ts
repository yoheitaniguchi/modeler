import { test, expect } from '@playwright/test';
import { deployCustomer, gotoUserMode, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('一括インポート / エクスポート', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployCustomer(api);
    await api.dispose();
  });

  test('一括登録ボタンでモーダルが開く', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await page.getByTestId('bulk-import-button').click();
    await expect(page.getByTestId('bulk-import-modal')).toBeVisible();
  });

  test('モーダル内のフォーマット選択ラジオ (CSV/TSV/JSON) が切り替えられる', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await page.getByTestId('bulk-import-button').click();

    // デフォルトは CSV
    await expect(page.getByTestId('format-csv')).toBeChecked();

    // TSV に切替
    await page.getByTestId('format-tsv').click();
    await expect(page.getByTestId('format-tsv')).toBeChecked();

    // JSON に切替
    await page.getByTestId('format-json').click();
    await expect(page.getByTestId('format-json')).toBeChecked();
  });

  test('正常な CSV をアップロードすると検証 OK → 登録 → 一覧に表示される', async ({
    page,
  }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await page.getByTestId('bulk-import-button').click();

    const csv = 'name,age,active\nAlice,30,true\nBob,25,false';
    await page.getByTestId('bulk-file-input').setInputFiles({
      name: 'data.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    // 検証 OK メッセージ
    await expect(page.getByTestId('bulk-validation-ok')).toBeVisible({ timeout: 10000 });
    // 登録ボタンが有効
    await expect(page.getByTestId('bulk-import-submit')).toBeEnabled();

    // 登録
    await page.getByTestId('bulk-import-submit').click();

    // モーダルが閉じる
    await expect(page.getByTestId('bulk-import-modal')).not.toBeVisible({ timeout: 10000 });

    // 一覧に Alice と Bob が表示される
    await expect(page.getByRole('cell', { name: 'Alice', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Bob', exact: true })).toBeVisible();
  });

  test('required フィールドが欠けた CSV はエラー表示 + ログダウンロードボタン', async ({
    page,
  }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();
    await page.getByTestId('bulk-import-button').click();

    const badCsv = 'name,age,active\n,30,true';
    await page.getByTestId('bulk-file-input').setInputFiles({
      name: 'bad.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(badCsv),
    });

    // エラーテーブルが表示される
    await expect(page.getByTestId('bulk-validation-errors')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('bulk-error-table')).toBeVisible();
    // 登録ボタンは無効
    await expect(page.getByTestId('bulk-import-submit')).toBeDisabled();
    // ダウンロードボタン表示
    await expect(page.getByTestId('bulk-download-log')).toBeVisible();
  });

  test('登録されたレコードが詳細画面で編集・削除できる', async ({ page }) => {
    // API で 1 件インポートしてから一覧 → 編集 → 削除
    const api = await newApiContext();
    await api.post('http://localhost:4000/api/customer/import', {
      multipart: {
        format: 'csv',
        file: {
          name: 'import.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('name,age,active\nTestUser,20,true'),
        },
      },
    });
    await api.dispose();

    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();

    // TestUser が一覧に表示される
    await expect(page.getByRole('cell', { name: 'TestUser', exact: true })).toBeVisible();

    // 編集
    const row = page.getByRole('row').filter({ hasText: 'TestUser' });
    await row.getByRole('button', { name: '更新' }).click();
    await page.getByPlaceholder('氏名 *').fill('UpdatedUser');
    await page.getByTestId('modal-save-and-close').click();
    await expect(page.getByRole('cell', { name: 'UpdatedUser', exact: true })).toBeVisible();

    // 削除
    const updRow = page.getByRole('row').filter({ hasText: 'UpdatedUser' });
    await updRow.getByRole('button', { name: '削除' }).click();
    await expect(page.getByRole('cell', { name: 'UpdatedUser', exact: true })).toHaveCount(0);
  });

  test('エクスポートボタンのリンクが TSV 形式になっている', async ({ page }) => {
    await gotoUserMode(page);
    await page.getByTestId('deployed-model-link-customer').click();

    // エクスポートボタンは常に TSV
    const href = await page.getByTestId('export-button').getAttribute('href');
    expect(href).toContain('format=tsv');

    // フォーマット選択コンボは存在しない
    await expect(page.getByTestId('export-format-select')).toHaveCount(0);
  });
});
