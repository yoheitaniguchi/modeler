import { test, expect, type APIRequestContext } from '@playwright/test';
import { newApiContext, resetDeployedModels } from './helpers.js';

/**
 * テーブル間リレーション機能の E2E テスト (API 経由)。
 *
 * 検証スコープ:
 *   1. onDelete=restrict — 被参照ありで親削除は 400
 *   2. onDelete=cascade — 親削除で子レコードも連鎖削除
 *   3. onDelete=setNull — 親削除で子の FK 列が null になる
 *   4. 不正な FK ID で子レコード作成 → 400
 *
 * UI 経由 (relationKind / onDelete セレクト操作) の検証は単体テスト側に委ねる。
 * E2E では「サーバー全体を通したときに FK 整合性が機能するか」だけを確認する。
 */

const BASE = 'http://localhost:4000';

async function deployDeptEmp(
  api: APIRequestContext,
  onDelete: 'restrict' | 'cascade' | 'setNull' | 'noAction',
  employeeDeptRequired: boolean,
) {
  const res = await api.post(`${BASE}/meta/deploy`, {
    data: {
      version: 1,
      models: [
        {
          name: 'department',
          label: '部署',
          fields: [{ name: 'name', label: '名称', type: 'string', required: true }],
        },
        {
          name: 'employee',
          label: '従業員',
          fields: [
            { name: 'name', label: '氏名', type: 'string', required: true },
            {
              name: 'dept',
              label: '所属',
              type: 'reference',
              required: employeeDeptRequired,
              targetModel: 'department',
              targetLabelField: 'name',
              onDelete,
            },
          ],
        },
      ],
    },
  });
  expect(res.status()).toBe(200);
}

test.describe('リレーション — FK 整合性 (API)', () => {
  // 各テストはサーバーが既に動いていれば数百ms で済むが、
  // webServer 初回起動が含まれる 1 件目で 30s を超える環境があるため余裕を持たせる。
  test.setTimeout(60_000);

  test.beforeEach(async () => {
    const api = await newApiContext();
    await resetDeployedModels(api);
    await api.dispose();
  });

  test('onDelete=restrict — 被参照ありで Department 削除は 400', async () => {
    const api = await newApiContext();
    await deployDeptEmp(api, 'restrict', false);

    const deptRes = await api.post(`${BASE}/api/department`, { data: { name: 'sales' } });
    expect(deptRes.status()).toBe(201);
    const dept = await deptRes.json();

    const empRes = await api.post(`${BASE}/api/employee`, {
      data: { name: 'Alice', dept: dept.id },
    });
    expect(empRes.status()).toBe(201);

    const delRes = await api.delete(`${BASE}/api/department/${dept.id}`);
    expect(delRes.status()).toBe(400);
    const body = await delRes.json();
    expect(body.errors.join(' ')).toMatch(/cannot delete/i);

    // Department は残っているはず
    const stillExists = await api.get(`${BASE}/api/department/${dept.id}`);
    expect(stillExists.status()).toBe(200);
    await api.dispose();
  });

  test('onDelete=cascade — Department 削除で Employee も連鎖削除', async () => {
    const api = await newApiContext();
    await deployDeptEmp(api, 'cascade', false);

    const dept = await (await api.post(`${BASE}/api/department`, { data: { name: 'eng' } })).json();
    const emp = await (
      await api.post(`${BASE}/api/employee`, { data: { name: 'Bob', dept: dept.id } })
    ).json();

    const delRes = await api.delete(`${BASE}/api/department/${dept.id}`);
    expect(delRes.status()).toBe(204);

    // 両方消えているはず
    expect((await api.get(`${BASE}/api/department/${dept.id}`)).status()).toBe(404);
    expect((await api.get(`${BASE}/api/employee/${emp.id}`)).status()).toBe(404);
    await api.dispose();
  });

  test('onDelete=setNull — Department 削除で Employee.dept が null になる', async () => {
    const api = await newApiContext();
    await deployDeptEmp(api, 'setNull', false);

    const dept = await (await api.post(`${BASE}/api/department`, { data: { name: 'ops' } })).json();
    const emp = await (
      await api.post(`${BASE}/api/employee`, { data: { name: 'Carol', dept: dept.id } })
    ).json();

    const delRes = await api.delete(`${BASE}/api/department/${dept.id}`);
    expect(delRes.status()).toBe(204);

    const updated = await (await api.get(`${BASE}/api/employee/${emp.id}`)).json();
    expect(updated.dept).toBeNull();
    await api.dispose();
  });

  test('不正な FK ID で Employee 作成 → 400', async () => {
    const api = await newApiContext();
    await deployDeptEmp(api, 'restrict', false);

    const res = await api.post(`${BASE}/api/employee`, {
      data: { name: 'Ghost', dept: 'nonexistent-id' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errors.join(' ')).toMatch(/does not exist/i);
    await api.dispose();
  });
});

