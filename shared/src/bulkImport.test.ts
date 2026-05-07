import { describe, it, expect } from 'vitest';
import { parseBulkImport, formatErrorLog, serializeRecords } from './bulkImport.js';
import type { ModelDefinition, Record as ModelRecord } from './model.js';

/** テスト用モデル定義 */
const model: ModelDefinition = {
  name: 'customer',
  label: '顧客',
  fields: [
    { name: 'name', label: '氏名', type: 'string', required: true },
    { name: 'age', label: '年齢', type: 'number', required: false },
    { name: 'active', label: '有効', type: 'boolean', required: false },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// CSV パース
// ──────────────────────────────────────────────────────────────────────────────
describe('parseBulkImport (CSV)', () => {
  it('正常なCSVを正しくパースできる', () => {
    const csv = 'name,age,active\nAlice,30,true\nBob,25,false';
    const result = parseBulkImport(csv, 'csv', model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ name: 'Alice', age: 30, active: true });
    expect(result.records[1]).toMatchObject({ name: 'Bob', age: 25, active: false });
  });

  it('required フィールドが空の場合エラーを返す', () => {
    const csv = 'name,age,active\n,30,true';
    const result = parseBulkImport(csv, 'csv', model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0]).toMatchObject({ row: 1, field: 'name' });
  });

  it('複数行に複数エラーがある場合すべて収集する', () => {
    const csv = 'name,age,active\n,notNumber,true\n,30,true';
    const result = parseBulkImport(csv, 'csv', model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 行 1: name 欠け + age が数値でない (ただし number('notNumber') = NaN → 文字列 'notNumber' のまま)
    // 行 2: name 欠け
    const rows = result.rowErrors.map((e) => e.row);
    expect(rows).toContain(1);
    expect(rows).toContain(2);
  });

  it('データ行が 0 件のときパースエラーを返す', () => {
    const csv = 'name,age,active\n';
    const result = parseBulkImport(csv, 'csv', model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.parseError).toBeTruthy();
  });

  it('ダブルクォートで囲まれたカンマを含む値を正しく扱う', () => {
    const csv = 'name,age,active\n"Smith, John",40,true';
    const result = parseBulkImport(csv, 'csv', model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0].name).toBe('Smith, John');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// TSV パース
// ──────────────────────────────────────────────────────────────────────────────
describe('parseBulkImport (TSV)', () => {
  it('正常な TSV をパースできる', () => {
    const tsv = 'name\tage\tactive\nCharlie\t22\ttrue';
    const result = parseBulkImport(tsv, 'tsv', model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]).toMatchObject({ name: 'Charlie', age: 22, active: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// JSON パース
// ──────────────────────────────────────────────────────────────────────────────
describe('parseBulkImport (JSON)', () => {
  it('正常な JSON 配列をパースできる', () => {
    const json = JSON.stringify([{ name: 'Dave', age: 35, active: false }]);
    const result = parseBulkImport(json, 'json', model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]).toMatchObject({ name: 'Dave', age: 35, active: false });
  });

  it('JSON がオブジェクトのときパースエラーを返す', () => {
    const json = JSON.stringify({ name: 'Eve' });
    const result = parseBulkImport(json, 'json', model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.parseError).toMatch(/配列/);
  });

  it('不正な JSON のときパースエラーを返す', () => {
    const result = parseBulkImport('{broken json', 'json', model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.parseError).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// エラーログ整形
// ──────────────────────────────────────────────────────────────────────────────
describe('formatErrorLog', () => {
  it('RowError 配列を TSV 形式に整形する', () => {
    const errors = [
      { row: 1, field: 'name', message: 'is required (NOT NULL)' },
      { row: 3, field: 'age', message: 'must be number' },
    ];
    const log = formatErrorLog(errors);
    const lines = log.split('\n');
    expect(lines[0]).toBe('行番号\tフィールド\tエラー内容');
    expect(lines[1]).toBe('1\tname\tis required (NOT NULL)');
    expect(lines[2]).toBe('3\tage\tmust be number');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// エクスポート (serializeRecords)
// ──────────────────────────────────────────────────────────────────────────────
describe('serializeRecords', () => {
  const records: ModelRecord[] = [
    { id: 'uuid-1', name: 'Alice', age: 30, active: true },
    { id: 'uuid-2', name: 'Bob', age: 25, active: false },
  ];

  it('CSV に変換できる', () => {
    const csv = serializeRecords(records, 'csv', model);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('name,age,active');
    expect(lines[1]).toBe('Alice,30,true');
  });

  it('TSV に変換できる', () => {
    const tsv = serializeRecords(records, 'tsv', model);
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('name\tage\tactive');
    expect(lines[1]).toBe('Alice\t30\ttrue');
  });

  it('JSON に変換できる', () => {
    const json = serializeRecords(records, 'json', model);
    const parsed = JSON.parse(json) as ModelRecord[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Alice');
  });

  it('カンマを含む値はダブルクォートでエスケープされる', () => {
    const r: ModelRecord[] = [{ id: 'x', name: 'Smith, John', age: 40, active: true }];
    const csv = serializeRecords(r, 'csv', model);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('"Smith, John"');
  });
});
