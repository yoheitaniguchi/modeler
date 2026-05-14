import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelDefinition } from '@modeler/shared';
import { PostgresDao, DaoValidationError } from './postgresDao.js';
import { DaoRegistryImpl } from './daoRegistry.js';
import type { Dao } from './dao.js';
import { createTestDb, TEST_DB_AVAILABLE, type TestDbHandle } from './testDb.js';
import { createTableForModel } from '../db/schema.js';

const model: ModelDefinition = {
  name: 'item',
  label: '商品',
  fields: [
    { name: 'name', label: '名称', type: 'string', required: true },
    { name: 'price', label: '価格', type: 'number', required: true },
    { name: 'note', label: '備考', type: 'string', required: false },
  ],
};

describe.skipIf(!TEST_DB_AVAILABLE)('PostgresDao', () => {
  let db: TestDbHandle;
  let dao: PostgresDao;

  beforeEach(async () => {
    db = await createTestDb();
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, model);
    } finally {
      c.release();
    }
    dao = new PostgresDao(model, db.pool);
    await dao.init();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('init 直後の list は空', async () => {
    expect(await dao.list()).toEqual([]);
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

  it('並行 create が全件保存される', async () => {
    await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        dao.create({ name: `item-${i}`, price: i }),
      ),
    );
    const list = await dao.list();
    expect(list).toHaveLength(5);
  });

  it('softDelete 有効時、remove は _deleted を立てる', async () => {
    const softModel: ModelDefinition = { ...model, name: 'soft', softDelete: true };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, softModel);
    } finally {
      c.release();
    }
    const softDao = new PostgresDao(softModel, db.pool);
    await softDao.init();
    const created = await softDao.create({ name: 'apple', price: 100 });
    expect(await softDao.list()).toHaveLength(1);

    expect(await softDao.remove(created.id)).toBe(true);
    expect(await softDao.list()).toHaveLength(0);

    // 物理的には残っており _deleted=true で除外されているだけ
    const raw = await db.pool.query('SELECT * FROM "soft"');
    expect(raw.rowCount).toBe(1);
    expect(raw.rows[0]._deleted).toBe(true);
  });

  it('自動フォーマット (trim/全角→半角) が適用される', async () => {
    const fmtModel: ModelDefinition = {
      name: 'fmt',
      label: 'F',
      fields: [
        {
          name: 'code',
          label: 'C',
          type: 'string',
          required: true,
          formatters: { trim: true, fullWidthToHalfWidth: true },
        },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, fmtModel);
    } finally {
      c.release();
    }
    const fmtDao = new PostgresDao(fmtModel, db.pool);
    await fmtDao.init();
    const created = await fmtDao.create({ code: ' ＡＢＣ ' });
    expect(created.code).toBe('ABC');
  });

  it('ユニーク制約が機能する', async () => {
    const uModel: ModelDefinition = {
      name: 'unique_test',
      label: 'U',
      fields: [
        { name: 'email', label: 'Email', type: 'string', required: true, validation: { unique: true } },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, uModel);
    } finally {
      c.release();
    }
    const uDao = new PostgresDao(uModel, db.pool);
    await uDao.init();
    await uDao.create({ email: 'test@example.com' });
    await expect(uDao.create({ email: 'test@example.com' })).rejects.toBeInstanceOf(DaoValidationError);
    const second = await uDao.create({ email: 'other@example.com' });
    await expect(uDao.update(second.id, { email: 'test@example.com' })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('単一主キーの一意制約が機能する', async () => {
    const pkModel: ModelDefinition = {
      name: 'pk_test',
      label: 'PK',
      fields: [
        { name: 'code', label: 'コード', type: 'string', required: true, primaryKey: true },
        { name: 'name', label: '名称', type: 'string', required: false },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, pkModel);
    } finally {
      c.release();
    }
    const pkDao = new PostgresDao(pkModel, db.pool);
    await pkDao.init();
    await pkDao.create({ code: 'A01', name: 'りんご' });
    await expect(pkDao.create({ code: 'A01', name: 'ばなな' })).rejects.toBeInstanceOf(DaoValidationError);
    const second = await pkDao.create({ code: 'A02', name: 'ばなな' });
    await expect(pkDao.update(second.id, { code: 'A01', name: 'ばなな' })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('複合主キーの一意制約が機能する', async () => {
    const cModel: ModelDefinition = {
      name: 'composite_pk',
      label: 'C',
      fields: [
        { name: 'tenant_id', label: 'T', type: 'string', required: true, primaryKey: true },
        { name: 'user_id', label: 'U', type: 'string', required: true, primaryKey: true },
        { name: 'role', label: 'R', type: 'string', required: false },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, cModel);
    } finally {
      c.release();
    }
    const cDao = new PostgresDao(cModel, db.pool);
    await cDao.init();
    await cDao.create({ tenant_id: 't1', user_id: 'u1', role: 'admin' });
    await cDao.create({ tenant_id: 't1', user_id: 'u2' });
    await cDao.create({ tenant_id: 't2', user_id: 'u1' });
    await expect(
      cDao.create({ tenant_id: 't1', user_id: 'u1', role: 'other' }),
    ).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('id 型フィールドは未指定なら UUID 自動採番', async () => {
    const iModel: ModelDefinition = {
      name: 'id_auto',
      label: 'ID',
      fields: [
        { name: 'uid', label: 'UID', type: 'id', required: false, primaryKey: true },
        { name: 'name', label: '名称', type: 'string', required: true },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, iModel);
    } finally {
      c.release();
    }
    const iDao = new PostgresDao(iModel, db.pool);
    await iDao.init();
    const created = await iDao.create({ name: '山田太郎' });
    expect(typeof created.uid).toBe('string');
    expect((created.uid as string).length).toBeGreaterThan(10);
  });

  it('登録時 defaultValue="today" で今日の日付が入る', async () => {
    const dModel: ModelDefinition = {
      name: 'date_today',
      label: 'D',
      fields: [
        { name: 'name', label: '名称', type: 'string', required: true },
        { name: 'created_at', label: '登録日', type: 'date', required: false, defaultValue: 'today' },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, dModel);
    } finally {
      c.release();
    }
    const dDao = new PostgresDao(dModel, db.pool);
    await dDao.init();
    const created = await dDao.create({ name: 'バナナ' });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(created.created_at).toBe(today);
  });

  it('更新時 defaultOnUpdate=true で今日の日付に更新', async () => {
    const dModel: ModelDefinition = {
      name: 'date_upd',
      label: 'D',
      fields: [
        { name: 'name', label: '名称', type: 'string', required: true },
        { name: 'updated_at', label: '更新日', type: 'date', required: false, defaultOnUpdate: true },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, dModel);
    } finally {
      c.release();
    }
    const dDao = new PostgresDao(dModel, db.pool);
    await dDao.init();
    const created = await dDao.create({ name: 'リンゴ', updated_at: '2020-01-01' });
    expect(created.updated_at).toBe('2020-01-01');
    const updated = await dDao.update(created.id, { name: 'リンゴ改', updated_at: '2020-01-01' });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(updated?.updated_at).toBe(today);
  });

  it('softDelete + defaultOnUpdate=true は削除時に日付が入る', async () => {
    const dModel: ModelDefinition = {
      name: 'delete_date',
      label: 'D',
      softDelete: true,
      fields: [
        { name: 'name', label: '名称', type: 'string', required: true },
        { name: 'deleted_at', label: '削除日', type: 'date', required: false, defaultOnUpdate: true },
      ],
    };
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, dModel);
    } finally {
      c.release();
    }
    const dDao = new PostgresDao(dModel, db.pool);
    await dDao.init();
    const created = await dDao.create({ name: 'メロン' });
    expect(await dDao.remove(created.id)).toBe(true);
    const raw = await db.pool.query('SELECT * FROM "delete_date"');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(raw.rows[0].deleted_at).toBe(today);
  });
});

describe.skipIf(!TEST_DB_AVAILABLE)('PostgresDao — FK 整合性', () => {
  let db: TestDbHandle;

  const departmentModel: ModelDefinition = {
    name: 'department',
    label: '部署',
    fields: [{ name: 'name', label: '名称', type: 'string', required: true }],
  };

  function makeEmployeeModel(onDelete?: 'restrict' | 'cascade' | 'setNull' | 'noAction', required = false): ModelDefinition {
    return {
      name: 'employee',
      label: '従業員',
      fields: [
        { name: 'name', label: '氏名', type: 'string', required: true },
        {
          name: 'dept',
          label: '部署',
          type: 'reference',
          required,
          targetModel: 'department',
          ...(onDelete ? { onDelete } : {}),
        },
      ],
    };
  }

  async function buildSetup(onDelete?: 'restrict' | 'cascade' | 'setNull' | 'noAction', required = false) {
    const emp = makeEmployeeModel(onDelete, required);
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, departmentModel);
      await createTableForModel(c, emp);
    } finally {
      c.release();
    }
    const deptDao = new PostgresDao(departmentModel, db.pool);
    const empDao = new PostgresDao(emp, db.pool);
    const daoMap = new Map<string, Dao>([
      ['department', deptDao],
      ['employee', empDao],
    ]);
    const reg = new DaoRegistryImpl(daoMap, [departmentModel, emp]);
    deptDao.setRegistry(reg);
    empDao.setRegistry(reg);
    return { deptDao, empDao };
  }

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('存在しない FK ID で create → DaoValidationError', async () => {
    const { empDao } = await buildSetup();
    await expect(empDao.create({ name: 'Alice', dept: 'nonexistent' })).rejects.toBeInstanceOf(DaoValidationError);
  });

  it('存在する FK ID で create → 成功', async () => {
    const { deptDao, empDao } = await buildSetup();
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(emp.dept).toBe(dept.id);
  });

  it('onDelete=restrict — 被参照があれば削除を阻止', async () => {
    const { deptDao, empDao } = await buildSetup('restrict');
    const dept = await deptDao.create({ name: 'sales' });
    await empDao.create({ name: 'Alice', dept: dept.id });
    await expect(deptDao.remove(dept.id)).rejects.toBeInstanceOf(DaoValidationError);
    expect(await deptDao.get(dept.id)).not.toBeNull();
  });

  it('onDelete=cascade — 被参照レコードも連鎖削除', async () => {
    const { deptDao, empDao } = await buildSetup('cascade');
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(await deptDao.remove(dept.id)).toBe(true);
    expect(await deptDao.get(dept.id)).toBeNull();
    expect(await empDao.get(emp.id)).toBeNull();
  });

  it('onDelete=setNull — 被参照レコードのフィールドが null になる', async () => {
    const { deptDao, empDao } = await buildSetup('setNull');
    const dept = await deptDao.create({ name: 'sales' });
    const emp = await empDao.create({ name: 'Alice', dept: dept.id });
    expect(await deptDao.remove(dept.id)).toBe(true);
    expect(await deptDao.get(dept.id)).toBeNull();
    const updated = await empDao.get(emp.id);
    expect(updated).not.toBeNull();
    expect(updated?.dept).toBeNull();
  });

  it('被参照がなければ restrict でも削除できる', async () => {
    const { deptDao, empDao } = await buildSetup('restrict');
    const dept = await deptDao.create({ name: 'sales' });
    expect(await deptDao.remove(dept.id)).toBe(true);
    expect(await empDao.list()).toHaveLength(0);
  });
});
