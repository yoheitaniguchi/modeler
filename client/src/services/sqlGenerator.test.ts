import { describe, expect, it } from 'vitest';
import type { ModelDefinition } from '@modeler/shared';
import { buildSqlFilename, generateCreateTable } from './sqlGenerator.js';

const allTypes: ModelDefinition = {
  name: 'sample',
  label: 'サンプル',
  fields: [
    { name: 'name', label: '氏名', type: 'string', required: true },
    { name: 'age', label: '年齢', type: 'number', required: false },
    { name: 'active', label: '有効', type: 'boolean', required: false },
    { name: 'created_at', label: '作成日時', type: 'date', required: false },
  ],
};

describe('generateCreateTable', () => {
  it('PostgreSQL: 4 型のマッピングと NOT NULL を出力', () => {
    const sql = generateCreateTable(allTypes, 'postgresql');
    expect(sql).toBe(
      'CREATE TABLE "sample" (\n' +
        '  "name" TEXT NOT NULL,\n' +
        '  "age" DOUBLE PRECISION,\n' +
        '  "active" BOOLEAN,\n' +
        '  "created_at" TIMESTAMP\n' +
        ');\n',
    );
  });

  it('SQLite: 型マッピングが PG とは異なる', () => {
    const sql = generateCreateTable(allTypes, 'sqlite');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"age" NUMERIC');
    expect(sql).toContain('"active" INTEGER');
    expect(sql).toContain('"created_at" TEXT');
  });

  it('MS Access: 角括弧クォートと BIT/DOUBLE/DATETIME', () => {
    const sql = generateCreateTable(allTypes, 'msaccess');
    expect(sql).toContain('CREATE TABLE [sample]');
    expect(sql).toContain('[name] TEXT NOT NULL');
    expect(sql).toContain('[age] DOUBLE');
    expect(sql).toContain('[active] BIT');
    expect(sql).toContain('[created_at] DATETIME');
  });

  it('string の defaultValue はシングルクォートでエスケープされる', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'n', label: 'n', type: 'string', required: false, defaultValue: "O'Brien" }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain(`"n" TEXT DEFAULT 'O''Brien'`);
  });

  it('boolean の defaultValue は方言ごとに表記が異なる', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'b', label: 'b', type: 'boolean', required: false, defaultValue: true }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain('DEFAULT TRUE');
    expect(generateCreateTable(m, 'sqlite')).toContain('DEFAULT 1');
    expect(generateCreateTable(m, 'msaccess')).toContain('DEFAULT True');
  });

  it('number の defaultValue は数値リテラルとして埋め込む', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'x', label: 'x', type: 'number', required: false, defaultValue: 3.14 }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain('DEFAULT 3.14');
  });

  it('null / undefined / NaN / Infinity は DEFAULT 句を出力しない', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [
        { name: 'a', label: 'a', type: 'string', required: false, defaultValue: null },
        { name: 'b', label: 'b', type: 'string', required: false, defaultValue: undefined },
        { name: 'c', label: 'c', type: 'number', required: false, defaultValue: Number.NaN },
        { name: 'd', label: 'd', type: 'number', required: false, defaultValue: Number.POSITIVE_INFINITY },
      ],
    };
    const sql = generateCreateTable(m, 'postgresql');
    expect(sql).not.toContain('DEFAULT');
  });

  it('required + defaultValue を両方持つフィールドは両方出力する', () => {
    const m: ModelDefinition = {
      name: 't',
      label: 't',
      fields: [{ name: 'n', label: 'n', type: 'string', required: true, defaultValue: 'x' }],
    };
    expect(generateCreateTable(m, 'postgresql')).toContain(`"n" TEXT NOT NULL DEFAULT 'x'`);
  });

  it('フィールド 0 件は Error を throw', () => {
    const empty: ModelDefinition = { name: 't', label: 't', fields: [] };
    expect(() => generateCreateTable(empty, 'postgresql')).toThrow(/フィールドが0件/);
  });
});

describe('buildSqlFilename', () => {
  it('指定の Date からゼロ詰めしたタイムスタンプ付きファイル名を作る', () => {
    const fixed = new Date(2026, 4, 6, 9, 7, 5);
    expect(buildSqlFilename('customer', 'postgresql', fixed)).toBe(
      'customer-20260506-090705-postgresql.sql',
    );
    expect(buildSqlFilename('order', 'sqlite', fixed)).toBe('order-20260506-090705-sqlite.sql');
    expect(buildSqlFilename('order', 'msaccess', fixed)).toBe('order-20260506-090705-msaccess.sql');
  });
});
