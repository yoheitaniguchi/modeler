import { useState } from 'react';
import type { FieldDefinition } from '@modeler/shared';
import type { FieldFilter, FilterMap } from '../services/filter.js';

/**
 * 検索 UI。
 *  - 既定ではキーワード入力のみ表示 (シンプル)
 *  - 「詳細検索」を開くとフィールドごとの条件指定が可能
 *
 * 状態は親 (CrudView) に持たせて URL 同期や永続化に拡張しやすくする。
 */
export function SearchBar({
  fields,
  keyword,
  filters,
  onKeywordChange,
  onFiltersChange,
  hits,
  total,
}: {
  fields: FieldDefinition[];
  keyword: string;
  filters: FilterMap;
  onKeywordChange: (v: string) => void;
  onFiltersChange: (v: FilterMap) => void;
  hits: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);

  const updateFilter = (name: string, cond: FieldFilter | undefined) => {
    const next: FilterMap = { ...filters };
    if (cond === undefined) delete next[name];
    else next[name] = cond;
    onFiltersChange(next);
  };

  return (
    <div className="search-bar" data-testid="search-bar">
      <div className="row" style={{ marginBottom: '0.4rem' }}>
        <input
          type="search"
          placeholder="キーワード検索 (全項目あいまい一致)"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          style={{ flex: 1, minWidth: '14rem' }}
          data-testid="search-keyword"
        />
        <button
          className="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="toggle-advanced"
        >
          {open ? '詳細を閉じる' : '詳細検索'}
        </button>
        <button
          className="ghost"
          onClick={() => {
            onKeywordChange('');
            onFiltersChange({});
          }}
          data-testid="clear-search"
        >
          クリア
        </button>
        <span className="muted" style={{ marginLeft: 'auto' }} data-testid="hit-count">
          {hits} / {total} 件
        </span>
      </div>

      {open && (
        <div className="advanced-filters" data-testid="advanced-filters">
          {fields.map((f) => (
            <FilterRow
              key={f.name}
              field={f}
              value={filters[f.name]}
              onChange={(c) => updateFilter(f.name, c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: FieldFilter | undefined;
  onChange: (v: FieldFilter | undefined) => void;
}) {
  switch (field.type) {
    case 'string':
      return (
        <div className="row filter-row">
          <label style={{ width: '6rem' }}>{field.label}</label>
          <input
            type="text"
            placeholder="含む"
            value={value?.kind === 'string' ? value.contains : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') onChange(undefined);
              else onChange({ kind: 'string', contains: v });
            }}
          />
        </div>
      );
    case 'number': {
      const cur =
        value?.kind === 'number'
          ? value
          : { kind: 'number' as const, op: 'eq' as const, value: 0 };
      return (
        <div className="row filter-row">
          <label style={{ width: '6rem' }}>{field.label}</label>
          <select
            value={cur.op}
            onChange={(e) =>
              onChange({ ...cur, op: e.target.value as 'eq' | 'gte' | 'lte' })
            }
          >
            <option value="eq">=</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </select>
          <input
            type="number"
            value={value?.kind === 'number' ? value.value : ''}
            onChange={(e) => {
              if (e.target.value === '') onChange(undefined);
              else onChange({ ...cur, value: Number(e.target.value) });
            }}
          />
        </div>
      );
    }
    case 'boolean': {
      const v = value?.kind === 'boolean' ? value.value : undefined;
      return (
        <div className="row filter-row">
          <label style={{ width: '6rem' }}>{field.label}</label>
          <select
            value={v === undefined ? '' : String(v)}
            onChange={(e) => {
              if (e.target.value === '') onChange(undefined);
              else onChange({ kind: 'boolean', value: e.target.value === 'true' });
            }}
          >
            <option value="">(指定なし)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
      );
    }
    case 'date': {
      const cur = value?.kind === 'date' ? value : { kind: 'date' as const };
      const setVal = (patch: Partial<typeof cur>) => {
        const next = { ...cur, ...patch };
        if (!next.from && !next.to) onChange(undefined);
        else onChange(next);
      };
      return (
        <div className="row filter-row">
          <label style={{ width: '6rem' }}>{field.label}</label>
          <input
            type="date"
            value={cur.from ?? ''}
            onChange={(e) => setVal({ from: e.target.value || undefined })}
          />
          <span>〜</span>
          <input
            type="date"
            value={cur.to ?? ''}
            onChange={(e) => setVal({ to: e.target.value || undefined })}
          />
        </div>
      );
    }
  }
}
