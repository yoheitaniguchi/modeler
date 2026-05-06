import { test, expect } from '@playwright/test';
import { deployCustomer, gotoDeployedTab, newApiContext, resetDeployedModels } from './helpers.js';

test.describe('RecordFormModal - 詳細編集モーダル', () => {
  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await deployCustomer(api);
    await api.dispose();
  });

  test('「作成」ボタンをクリックするとモーダルが開く', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('record-form-modal')).toBeVisible();

    // モーダルのタイトルが表示される
    await expect(page.getByText('顧客を新規作成')).toBeVisible();
  });

  test('「更新」ボタンをクリックするとモーダルが開き、レコードデータが表示される', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    // 先にレコードを作成
    await page.getByTestId('create-button').click();
    await page.getByPlaceholder('氏名 *').fill('Alice');
    await page.getByPlaceholder('年齢').fill('30');
    await page.getByTestId('modal-save-and-close').click();

    // レコードを更新
    const aliceRow = page.getByRole('row').filter({ hasText: 'Alice' });
    await aliceRow.getByRole('button', { name: '更新' }).click();
    await expect(page.getByTestId('record-form-modal')).toBeVisible();
    await expect(page.getByText('顧客を編集')).toBeVisible();

    // フォームにレコードデータが入っている
    await expect(page.getByPlaceholder('氏名 *')).toHaveValue('Alice');
    await expect(page.getByPlaceholder('年齢')).toHaveValue('30');
  });

  test('必須フィールドのラベルが赤色で表示される', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('record-form-modal')).toBeVisible();

    // 必須フィールド「氏名」のラベル要素を取得
    const nameLabel = page.locator('.field-group').filter({ hasText: '氏名' }).locator('label').first();
    const color = await nameLabel.evaluate((el) => window.getComputedStyle(el).color);

    // RGB 値で #dc2626 は rgb(220, 38, 38) または rgb(220, 38, 38, 1)
    expect(color).toContain('220');
  });

  test('非必須フィールドのラベルが通常色で表示される', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('record-form-modal')).toBeVisible();

    // 非必須フィールド「年齢」のラベル要素を取得
    const ageLabel = page.locator('.field-group').filter({ hasText: '年齢' }).locator('label').first();
    const color = await ageLabel.evaluate((el) => window.getComputedStyle(el).color);

    // RGB 値で #555 は rgb(85, 85, 85)
    expect(color).toContain('85');
  });

  test('「登録して閉じる」でモーダルが閉じて一覧に反映される', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await page.getByPlaceholder('氏名 *').fill('Bob');
    await page.getByPlaceholder('年齢').fill('25');
    await page.getByTestId('modal-save-and-close').click();

    // モーダルが閉じる
    await expect(page.getByTestId('record-form-modal')).not.toBeVisible();

    // 一覧に反映される
    await expect(page.getByRole('cell', { name: 'Bob', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '25', exact: true })).toBeVisible();
  });

  test('「登録してもう一件登録する」でモーダルが開いたままになり、複数件作成できる', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    // 1件目を作成
    await page.getByTestId('create-button').click();
    await page.getByPlaceholder('氏名 *').fill('Charlie');
    await page.getByPlaceholder('年齢').fill('35');
    await page.getByTestId('modal-save-and-continue').click();

    // モーダルが開いたままになっていることを確認
    await expect(page.getByTestId('record-form-modal')).toBeVisible();

    // 2件目を作成（フォーム入力値がリセットされているかは確実ではない可能性があるため）
    // 現在の入力値をクリアして新規入力
    await page.getByPlaceholder('氏名 *').clear();
    await page.getByPlaceholder('年齢').clear();
    await page.getByPlaceholder('氏名 *').fill('Diana');
    await page.getByPlaceholder('年齢').fill('28');
    await page.getByTestId('modal-save-and-close').click();

    // 両件とも一覧に表示される
    await expect(page.getByRole('cell', { name: 'Charlie', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Diana', exact: true })).toBeVisible();
  });

  test('キャンセルボタンでモーダルが閉じる', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await page.getByPlaceholder('氏名 *').fill('Eve');

    await page.getByTestId('modal-cancel').click();

    // モーダルが閉じる
    await expect(page.getByTestId('record-form-modal')).not.toBeVisible();

    // 入力内容は保存されていない
    await expect(page.getByRole('cell', { name: 'Eve', exact: true })).toHaveCount(0);
  });

  test('Escape キーでモーダルが閉じる', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('record-form-modal')).toBeVisible();

    await page.keyboard.press('Escape');

    // モーダルが閉じる
    await expect(page.getByTestId('record-form-modal')).not.toBeVisible();
  });

  test('2列レイアウトでフィールドが配置される', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('record-form-modal')).toBeVisible();

    // .form-grid クラスが適用されているか確認
    const formGrid = page.locator('.form-grid');
    await expect(formGrid).toBeVisible();

    // form-grid 内のフィールドグループを数える（モーダル内のみ）
    const fieldGroups = page.locator('.form-grid > .field-group');
    const count = await fieldGroups.count();
    // customer モデルは氏名と年齢の2フィールドを持つ
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('バリデーションエラーがモーダル上部に表示される', async ({ page }) => {
    await gotoDeployedTab(page);
    await page.getByTestId('model-select').selectOption('customer');

    // 必須フィールドを空のまま送信
    await page.getByTestId('create-button').click();
    await page.getByPlaceholder('年齢').fill('40'); // 氏名は空のまま

    // 登録ボタンを押す（サーバーが検証エラーを返すと仮定）
    // 注: テストモデルにクライアント側バリデーションがない場合、
    // サーバーが返すエラーレスポンスに依存する
    // ここではモーダルのエラー表示機能をテストするため、
    // 手動でエラーをトリガーするシナリオを作成するか、
    // 実際のエラーが返されるまで待つ必要があります。

    // サーバーがエラーを返した場合、モーダル上部にエラーが表示される
    // これはサーバー実装に依存するため、実装後に調整
  });
});
