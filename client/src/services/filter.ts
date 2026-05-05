import type { FieldDefinition, Record as ModelRecord } from '@modeler/shared';

/**
 * 検索/フィルタ/ソートの純粋関数群。
 *
 * 純粋関数として切り出すことで:
 *   - 単体テストが容易 (DOM 不要)
 *   - View / ViewModel どちらからも安全に使える
 *   - 後で IndexedDB 等への置き換えがしやすい
 */

/** フィールドごとの絞り込み条件。fieldName -> 条件オブジェクト。 */
export type FilterMap = Record<string, FieldFilter | undefined>;

export type FieldFilter =
  | { kind: 'string'; contains: string }
  | { kind: 'number'; op: 'eq' | 'gte' | 'lte'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; from?: string; to?: string };

export type SortDir = 'asc' | 'desc';

/** keyword は全フィールド横断のあいまい一致 (case-insensitive)。 */
export function applyFilters(
  records: ModelRecord[],
  fields: FieldDefinition[],
  keyword: string,
  filters: FilterMap,
): ModelRecord[] {
  const kw = keyword.trim().toLowerCase();
  return records.filter((rec) => {
    if (kw !== '' && !matchesKeyword(rec, fields, kw)) return false;
    for (const f of fields) {
      const cond = filters[f.name];
      if (!cond) continue;
      if (!matchesCondition(rec[f.name], cond)) return false;
    }
    return true;
  });
}

function matchesKeyword(
  rec: ModelRecord,
  fields: FieldDefinition[],
  kw: string,
): boolean {
  for (const f of fields) {
    const v = rec[f.name];
    if (v === undefined || v === null) continue;
    if (String(v).toLowerCase().includes(kw)) return true;
  }
  return false;
}

function matchesCondition(value: unknown, cond: FieldFilter): boolean {
  switch (cond.kind) {
    case 'string': {
      if (cond.contains === '') return true;
      if (typeof value !== 'string') return false;
      return value.toLowerCase().includes(cond.contains.toLowerCase());
    }
    case 'number': {
      if (typeof value !== 'number') return false;
      if (cond.op === 'eq') return value === cond.value;
      if (cond.op === 'gte') return value >= cond.value;
      return value <= cond.value;
    }
    case 'boolean':
      return Boolean(value) === cond.value;
    case 'date': {
      if (typeof value !== 'string') return false;
      const t = Date.parse(value);
      if (Number.isNaN(t)) return false;
      if (cond.from !== undefined && cond.from !== '') {
        const from = Date.parse(cond.from);
        if (!Number.isNaN(from) && t < from) return false;
      }
      if (cond.to !== undefined && cond.to !== '') {
        const to = Date.parse(cond.to);
        if (!Number.isNaN(to) && t > to) return false;
      }
      return true;
    }
  }
}

/** 列ソート。null/undefined は末尾。 */
export function applySort(
  records: ModelRecord[],
  field: FieldDefinition | null,
  dir: SortDir,
): ModelRecord[] {
  if (!field) return records;
  const sign = dir === 'asc' ? 1 : -1;
  const key = field.name;
  return [...records].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === undefined || av === null || av === '') return 1;
    if (bv === undefined || bv === null || bv === '') return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv)) * sign;
  });
}
