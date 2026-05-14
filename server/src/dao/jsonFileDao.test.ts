import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '@modeler/shared';
import { DaoValidationError, JsonFileDao } from './jsonFileDao.js';
import { DaoRegistryImpl } from './daoRegistry.js';

/**
 * DAO のテスト方針:
 *   - 一時ディレクトリで実ファイルを使う。これは direction.xml の意図
 *     「環境が正しく構築されたか」を担保するため。モックで誤魔化さない。
 *   - 各テストの前後で隔離する。
 */

const model: ModelDefinition = {
  name: 'item',
  label: '商品',
  fields: [
    { name: 'name', label: '名称', type: 'string', required: true },
    { name: 'price', label: '価格', type: 'number', required: true },
    { name: 'note', label: '備考', type: 'string', required: false },
  ],
};

describe('JsonFileDao', () => {
  let dataDir: string;
  let dao: JsonFileDao;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-dao-'));
    dao = new JsonFileDao(model, dataDir);
    await dao.init();
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('init で空配列の JSON ファイルが作られる', async () => {
    const list = await dao.list();
    expect(list).toEqual([]);
  });

  it('create + list で 1 件取れる', async () => {
    const created = await dao.create({ name: 'apple', price: 100 });
    expect(created.id).toBeTypeOf('string');
    expect(await dao.list()).toHaveLength(1);
  });

  it('required を満たさないと DaoValidationError', async () => {
    await expect(dao.create({ price: 100 })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('update は id を保持したまま値を差し替える', async () => {
    const created = await dao.create({ name: 'apple', price: 100 });
    const updated = await dao.update(created.id, { name: 'apple', price: 120 });
    expect(updated?.id).toBe(created.id);
    expect(updated?.price).toBe(120);
  });

  it('存在しない id の update は null', async () => {
    expect(await dao.update('missing', { name: 'a', price: 1 })).toBeNull();
  });

  it('remove で消える / もう一度 remove は false', async () => {
    const created = await dao.create({ name: 'apple', price: 100 });
    expect(await dao.remove(created.id)).toBe(true);
    expect(await dao.remove(created.id)).toBe(false);
  });

  it('並行 create が競合せず全件保存される (直列化の検証)', async () => {
    // 同期的に Promise を 5 つ作る = ほぼ同時発火。
    // ファイルロックがないと最後の write しか残らないバグが出やすい箇所。
    await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        dao.create({ name: `item-${i}`, price: i }),
      ),
    );
    const list = await dao.list();
    expect(list).toHaveLength(5);
  });

  it('softDelete有効時、removeで物理削除されず_deletedフラグが立つ', async () => {
    const softDao = new JsonFileDao({ ...model, name: 'soft', softDelete: true }, dataDir);
    await softDao.init();
    const created = await softDao.create({ name: 'apple', price: 100 });
    expect(await softDao.list()).toHaveLength(1);
    
    expect(await softDao.remove(created.id)).toBe(true);
    // list() は _deleted:true を除外するので 0件になる
    expect(await softDao.list()).toHaveLength(0);
    // ファイルには _deleted:true として残っていることを確認する
    const raw = await fs.readFile(path.join(dataDir, 'soft.json'), 'utf-8');
    const allRecords = JSON.parse(raw);
    expect(allRecords).toHaveLength(1);
    expect(allRecords[0]._deleted).toBe(true);
  });

  it('自動フォーマットが適用される', async () => {
    const formatDao = new JsonFileDao({
      ...model,
      name: 'format',
      fields: [
        { name: 'code', label: 'C', type: 'string', required: true, formatters: { trim: true, fullWidthToHalfWidth: true } }
      ]
    }, dataDir);
    await formatDao.init();
    const created = await formatDao.create({ code: ' ＡＢＣ ' });
    expect(created.code).toBe('ABC');
  });

  it('registry 未注入なら整合性チェックは no-op (後方互換)', async () => {
    // この dao は setRegistry を呼んでいないため、reference フィールドがあっても
    // checkOutgoingFkExist は何もしない。
    const refModel: ModelDefinition = {
      name: 'order',
      label: '注文',
      fields: [
        { name: 'customer', label: '顧客', type: 'reference', required: false, targetModel: 'customer' },
      ],
    };
    const refDao = new JsonFileDao(refModel, dataDir);
    await refDao.init();
    // どんな ID を渡しても通る (registry 未注入のため)
    const created = await refDao.create({ customer: 'nonexistent-id' });
    expect(created.customer).toBe('nonexistent-id');
  });

  it('ユニーク制約が機能する', async () => {
    const uniqueDao = new JsonFileDao({
      ...model,
      name: 'unique',
      fields: [
        { name: 'email', label: 'Email', type: 'string', required: true, validation: { unique: true } }
      ]
    }, dataDir);
    await uniqueDao.init();
    await uniqueDao.create({ email: 'test@example.com' });

    // duplicate create
    await expect(uniqueDao.create({ email: 'test@example.com' })).rejects.toBeInstanceOf(DaoValidationError);

    const second = await uniqueDao.create({ email: 'other@example.com' });
    // duplicate update
    await expect(uniqueDao.update(second.id, { email: 'test@example.com' })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('単一主キーの一意制約が機能する', async () => {
    const pkDao = new JsonFileDao({
      ...model,
      name: 'pk-test',
      fields: [
        { name: 'code', label: 'コード', type: 'string', required: true, primaryKey: true },
        { name: 'name', label: '名称', type: 'string', required: false },
      ],
    }, dataDir);
    await pkDao.init();
    await pkDao.create({ code: 'A01', name: 'りんご' });

    // 重複した主キーでの登録は失敗する
    await expect(pkDao.create({ code: 'A01', name: 'ばなな' })).rejects.toBeInstanceOf(DaoValidationError);

    // 別の主キーであれば登録できる
    const second = await pkDao.create({ code: 'A02', name: 'ばなな' });

    // 主キーを重複させる更新は失敗する
    await expect(pkDao.update(second.id, { code: 'A01', name: 'ばなな' })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('複合主キーの一意制約が機能する', async () => {
    const compositeDao = new JsonFileDao({
      ...model,
      name: 'composite-pk-test',
      fields: [
        { name: 'tenant_id', label: 'テナントID', type: 'string', required: true, primaryKey: true },
        { name: 'user_id', label: 'ユーザーID', type: 'string', required: true, primaryKey: true },
        { name: 'role', label: '役割', type: 'string', required: false },
      ],
    }, dataDir);
    await compositeDao.init();
    await compositeDao.create({ tenant_id: 'tenant-1', user_id: 'user-1', role: 'admin' });

    // 部分的に重複していても、全主キーの組み合わせが一意なら登録できる
    await compositeDao.create({ tenant_id: 'tenant-1', user_id: 'user-2', role: 'member' });
    await compositeDao.create({ tenant_id: 'tenant-2', user_id: 'user-1', role: 'member' });

    // 完全に重複した組み合わせでの登録は失敗する
    await expect(
      compositeDao.create({ tenant_id: 'tenant-1', user_id: 'user-1', role: 'other' })
    ).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('id型フィールドでのUUID自動採番が機能する', async () => {
    const idDao = new JsonFileDao({
      ...model,
      name: 'id-auto-test',
      fields: [
        { name: 'uid', label: 'UID', type: 'id', required: false, primaryKey: true },
        { name: 'name', label: '名称', type: 'string', required: true },
      ],
    }, dataDir);
    await idDao.init();

    // uidを空にして登録
    const created = await idDao.create({ name: '山田太郎' });
    const uid = created['uid'] as string;
    expect(uid).toBeTypeOf('string');
    expect(uid.length).toBeGreaterThan(10); // UUIDの妥当な長さ
    expect(created['name']).toBe('山田太郎');
  });

  it('登録時に defaultValue="today" であれば今日の日付が設定される', async () => {
    const todayDao = new JsonFileDao({
      ...model,
      name: 'today-create-test',
      fields: [
        { name: 'name', label: '名称', type: 'string', required: true },
        { name: 'created_at', label: '登録日', type: 'date', required: false, defaultValue: 'today' },
      ],
    }, dataDir);
    await todayDao.init();
    const created = await todayDao.create({ name: 'バナナ' });
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    expect(created.created_at).toBe(`${yyyy}-${mm}-${dd}`);
  });

  it('更新時に defaultOnUpdate=true であれば今日の日付で更新される', async () => {
    const updateDao = new JsonFileDao({
      ...model,
      name: 'update-date-test',
      fields: [
        { name: 'name', label: '名称', type: 'string', required: true },
        { name: 'updated_at', label: '更新日', type: 'date', required: false, defaultOnUpdate: true },
      ],
    }, dataDir);
    await updateDao.init();
    const created = await updateDao.create({ name: 'リンぎョ', updated_at: '2020-01-01' });
    expect(created.updated_at).toBe('2020-01-01');

    const updated = await updateDao.update(created.id, { name: 'リンゴ改', updated_at: '2020-01-01' });
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    expect(updated?.updated_at).toBe(`${yyyy}-${mm}-${dd}`);
  });

  it('論理削除時に defaultOnUpdate=true であれば今日の日付で更新される', async () => {
    const deleteDao = new JsonFileDao({
      ...model,
      name: 'delete-date-test',
      softDelete: true,
      fields: [
        { name: 'name', label: '名称', type: 'string', required: true },
        { name: 'deleted_at', label: '削除日', type: 'date', required: false, defaultOnUpdate: true },
      ],
    }, dataDir);
    await deleteDao.init();
    const created = await deleteDao.create({ name: 'メロン' });

    expect(await deleteDao.remove(created.id)).toBe(true);

    const raw = await fs.readFile(path.join(dataDir, 'delete-date-test.json'), 'utf-8');
    const allRecords = JSON.parse(raw);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    expect(allRecords[0].deleted_at).toBe(`${yyyy}-${mm}-${dd}`);
  });
});

/**
 * FK 整合性チェック (Task 6) の単体テスト。
 * DaoRegistry を手動で組み立てて DAO 同士を繋ぎ、create/update/remove の挙動を検証する。
 */
describe('JsonFileDao — FK 整合性', () => {
  let dataDir: string;

  const departmentModel: ModelDefinition = {
    name: 'department',
    label: '部署',
    fields: [{ name: 'name', label: '名称', type: 'string', required: true }],
  };

  function buildSetup(employeeOnDelete?: 'restrict' | 'cascade' | 'setNull' | 'noAction', employeeRequired = false) {
    const employeeModel: ModelDefinition = {
      name: 'employee',
      label: '従業員',
      fields: [
        { name: 'name', label: '氏名', type: 'string', required: true },
        {
          name: 'dept',
          label: '部署',
          type: 'reference',
          required: employeeRequired,
          targetModel: 'department',
          ...(employeeOnDelete ? { onDelete: employeeOnDelete } : {}),
        },
      ],
    };
    const deptDao = new JsonFileDao(departmentModel, dataDir);
    const empDao = new JsonFileDao(employeeModel, dataDir);
    const daoMap = new Map<string, JsonFileDao>([
      ['department', deptDao],
      ['employee', empDao],
    ]);
    const registry = new DaoRegistryImpl(daoMap, [departmentModel, employeeModel]);
    deptDao.setRegistry(registry);
    empDao.setRegistry(registry);
    return { deptDao, empDao };
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modeler-dao-fk-'));
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('存在しない FK ID で create → DaoValidationError', async () => {
    const { deptDao, empDao } = buildSetup();
    await deptDao.init();
    await empDao.init();
    await expect(empDao.create({ name: 'Alice', dept: 'nonexistent' })).rejects.toBeInstanceOf(
      DaoValidationError,
    );
  });

  it('存在する FK ID で create → 成功', async () => {
    const { deptDao, empDao } = buildSetup();
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(emp.dept).toBe(dept.id);
  });

  it('update で存在しない FK ID → DaoValidationError', async () => {
    const { deptDao, empDao } = buildSetup();
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    await expect(empDao.update(emp.id, { name: 'Alice', dept: 'missing' })).rejects.toBeInstanceOf(
      DaoValidationError,
    );
  });

  it('onDelete=restrict — 被参照があれば削除を阻止', async () => {
    const { deptDao, empDao } = buildSetup('restrict');
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    await empDao.create({ name: 'Alice', dept: dept.id });
    await expect(deptDao.remove(dept.id)).rejects.toBeInstanceOf(DaoValidationError);
    // Department は残ったまま
    expect(await deptDao.get(dept.id)).not.toBeNull();
  });

  it('onDelete=noAction — restrict と同様に阻止', async () => {
    const { deptDao, empDao } = buildSetup('noAction');
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    await empDao.create({ name: 'Alice', dept: dept.id });
    await expect(deptDao.remove(dept.id)).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('onDelete=cascade — 被参照レコードも連鎖削除', async () => {
    const { deptDao, empDao } = buildSetup('cascade');
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(await deptDao.remove(dept.id)).toBe(true);
    expect(await deptDao.get(dept.id)).toBeNull();
    expect(await empDao.get(emp.id)).toBeNull();
  });

  it('onDelete=setNull — 被参照レコードのフィールドが null になる', async () => {
    const { deptDao, empDao } = buildSetup('setNull');
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(await deptDao.remove(dept.id)).toBe(true);
    expect(await deptDao.get(dept.id)).toBeNull();
    const updated = await empDao.get(emp.id);
    expect(updated).not.toBeNull();
    expect(updated?.dept).toBeNull();
  });

  it('被参照がなければ restrict でも削除できる', async () => {
    const { deptDao, empDao } = buildSetup('restrict');
    await deptDao.init();
    await empDao.init();
    const dept = await deptDao.create({ name: 'sales' });
    expect(await deptDao.remove(dept.id)).toBe(true);
    expect(await empDao.list()).toHaveLength(0);
  });
});
