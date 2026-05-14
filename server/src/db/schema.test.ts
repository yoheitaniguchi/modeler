import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelDefinition } from '@modeler/shared';
import {
  analyzeChanges,
  createTableForModel,
  dropTableForModel,
  pgTypeFor,
  quoteIdent,
  tableExists,
} from './schema.js';
import { createTestDb, TEST_DB_AVAILABLE, type TestDbHandle } from '../dao/testDb.js';

describe('schema (純粋関数)', () => {
  it('quoteIdent はダブルクォートで囲む', () => {
    expect(quoteIdent('orders')).toBe('"orders"');
  });
  it('quoteIdent は内部のクォートをエスケープ', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
  it('pgTypeFor: string/reference/id → TEXT', () => {
    expect(pgTypeFor('string')).toBe('TEXT');
    expect(pgTypeFor('reference')).toBe('TEXT');
    expect(pgTypeFor('id')).toBe('TEXT');
  });
  it('pgTypeFor: number → DOUBLE PRECISION', () => {
    expect(pgTypeFor('number')).toBe('DOUBLE PRECISION');
  });
  it('pgTypeFor: boolean / date', () => {
    expect(pgTypeFor('boolean')).toBe('BOOLEAN');
    expect(pgTypeFor('date')).toBe('DATE');
  });
});

describe.skipIf(!TEST_DB_AVAILABLE)('schema (DB 検査)', () => {
  let db: TestDbHandle;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.cleanup(); });

  const baseModel: ModelDefinition = {
    name: 'simple',
    label: 'S',
    fields: [
      { name: 'name', label: '名称', type: 'string', required: true },
      { name: 'price', label: '価格', type: 'number', required: false },
    ],
  };

  it('createTableForModel で table と列が作られる', async () => {
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, baseModel);
      expect(await tableExists(c, 'simple')).toBe(true);
      const res = await c.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [db.schema, 'simple'],
      );
      const cols = res.rows.map((r) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('name');
      expect(cols).toContain('price');
      const nameRow = res.rows.find((r) => r.column_name === 'name');
      expect(nameRow?.is_nullable).toBe('NO');
    } finally {
      c.release();
    }
  });

  it('dropTableForModel で削除', async () => {
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, baseModel);
      await dropTableForModel(c, 'simple');
      expect(await tableExists(c, 'simple')).toBe(false);
    } finally {
      c.release();
    }
  });

  it('analyzeChanges: カラム削除は destructive', async () => {
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, baseModel);
      const newer: ModelDefinition = {
        ...baseModel,
        fields: baseModel.fields.filter((f) => f.name !== 'price'),
      };
      const analysis = await analyzeChanges(c, baseModel, newer);
      expect(analysis.destructive).toHaveLength(1);
      expect(analysis.destructive[0].kind).toBe('dropColumn');
    } finally {
      c.release();
    }
  });

  it('analyzeChanges: 空テーブルに必須カラム追加は safe', async () => {
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, baseModel);
      const newer: ModelDefinition = {
        ...baseModel,
        fields: [
          ...baseModel.fields,
          { name: 'sku', label: 'SKU', type: 'string', required: true },
        ],
      };
      const analysis = await analyzeChanges(c, baseModel, newer);
      expect(analysis.destructive).toHaveLength(0);
      expect(analysis.changes.some((ch) => ch.kind === 'addColumn')).toBe(true);
    } finally {
      c.release();
    }
  });

  it('analyzeChanges: データありで NOT NULL 追加は destructive', async () => {
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, baseModel);
      // データを 1 件挿入し、price=NULL の行を作る
      await c.query('INSERT INTO "simple" (id, name, price) VALUES ($1, $2, NULL)', ['x1', 'foo']);
      const newer: ModelDefinition = {
        ...baseModel,
        fields: baseModel.fields.map((f) => (f.name === 'price' ? { ...f, required: true } : f)),
      };
      const analysis = await analyzeChanges(c, baseModel, newer);
      const addNotNull = analysis.changes.find((ch) => ch.kind === 'addNotNull');
      expect(addNotNull?.destructive).toBe(true);
    } finally {
      c.release();
    }
  });

  it('analyzeChanges: 型変更で string→number は destructive', async () => {
    const c = await db.pool.connect();
    try {
      await createTableForModel(c, baseModel);
      const newer: ModelDefinition = {
        ...baseModel,
        fields: baseModel.fields.map((f) => (f.name === 'name' ? { ...f, type: 'number' as const } : f)),
      };
      const analysis = await analyzeChanges(c, baseModel, newer);
      const ch = analysis.changes.find((c) => c.kind === 'alterColumnType');
      expect(ch?.destructive).toBe(true);
    } finally {
      c.release();
    }
  });

  it('analyzeChanges: string ↔ reference は同じ TEXT で safe', async () => {
    const c = await db.pool.connect();
    try {
      const m1: ModelDefinition = {
        name: 'r1',
        label: 'R',
        fields: [{ name: 'a', label: 'A', type: 'string', required: false }],
      };
      const m2target: ModelDefinition = {
        name: 'r1_target',
        label: 'T',
        fields: [{ name: 'name', label: 'N', type: 'string', required: false }],
      };
      await createTableForModel(c, m2target);
      await createTableForModel(c, m1);
      const newer: ModelDefinition = {
        ...m1,
        fields: [{ name: 'a', label: 'A', type: 'reference', required: false, targetModel: 'r1_target' }],
      };
      const analysis = await analyzeChanges(c, m1, newer);
      const ch = analysis.changes.find((c) => c.kind === 'alterColumnType');
      expect(ch?.destructive).toBe(false);
    } finally {
      c.release();
    }
  });
});
