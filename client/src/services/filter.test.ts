import { describe, expect, it } from 'vitest';
import type { FieldDefinition, Record as ModelRecord } from '@modeler/shared';
import { applyFilters, applySort } from './filter.js';

const fields: FieldDefinition[] = [
  { name: 'name', label: '名前', type: 'string', required: true },
  { name: 'age', label: '年齢', type: 'number', required: false },
  { name: 'active', label: '有効', type: 'boolean', required: false },
  { name: 'birthday', label: '誕生日', type: 'date', required: false },
];

const records: ModelRecord[] = [
  { id: '1', name: 'Alice', age: 30, active: true, birthday: '1995-04-01' },
  { id: '2', name: 'Bob', age: 25, active: false, birthday: '2000-01-15' },
  { id: '3', name: 'Charlie', age: 40, active: true, birthday: '1985-06-30' },
];

describe('applyFilters', () => {
  it('keyword 空ならすべて返す', () => {
    expect(applyFilters(records, fields, '', {}).length).toBe(3);
  });

  it('keyword は大文字小文字無視で全フィールド横断', () => {
    expect(applyFilters(records, fields, 'ali', {}).map((r) => r.id)).toEqual(['1']);
    expect(applyFilters(records, fields, '40', {}).map((r) => r.id)).toEqual(['3']);
  });

  it('string contains フィルタ', () => {
    const out = applyFilters(records, fields, '', {
      name: { kind: 'string', contains: 'b' },
    });
    expect(out.map((r) => r.id)).toEqual(['2']);
  });

  it('number eq/gte/lte', () => {
    expect(
      applyFilters(records, fields, '', {
        age: { kind: 'number', op: 'gte', value: 30 },
      }).map((r) => r.id),
    ).toEqual(['1', '3']);
    expect(
      applyFilters(records, fields, '', {
        age: { kind: 'number', op: 'lte', value: 25 },
      }).map((r) => r.id),
    ).toEqual(['2']);
    expect(
      applyFilters(records, fields, '', {
        age: { kind: 'number', op: 'eq', value: 30 },
      }).map((r) => r.id),
    ).toEqual(['1']);
  });

  it('boolean フィルタ', () => {
    expect(
      applyFilters(records, fields, '', {
        active: { kind: 'boolean', value: true },
      }).map((r) => r.id),
    ).toEqual(['1', '3']);
  });

  it('date 範囲', () => {
    expect(
      applyFilters(records, fields, '', {
        birthday: { kind: 'date', from: '1990-01-01', to: '1999-12-31' },
      }).map((r) => r.id),
    ).toEqual(['1']);
  });

  it('複合条件は AND', () => {
    expect(
      applyFilters(records, fields, 'a', {
        age: { kind: 'number', op: 'gte', value: 35 },
      }).map((r) => r.id),
    ).toEqual(['3']);
  });
});

describe('applySort', () => {
  it('field=null ならそのまま返す', () => {
    expect(applySort(records, null, 'asc').map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('数値の昇順/降順', () => {
    expect(applySort(records, fields[1], 'asc').map((r) => r.id)).toEqual(['2', '1', '3']);
    expect(applySort(records, fields[1], 'desc').map((r) => r.id)).toEqual(['3', '1', '2']);
  });

  it('文字列の昇順', () => {
    expect(applySort(records, fields[0], 'asc').map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('null/undefined は末尾', () => {
    const r2: ModelRecord[] = [
      { id: 'a', name: 'X', age: 10 },
      { id: 'b', name: 'Y' },
      { id: 'c', name: 'Z', age: 5 },
    ];
    expect(applySort(r2, fields[1], 'asc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
