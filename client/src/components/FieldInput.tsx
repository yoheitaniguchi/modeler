import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldDefinition } from '@modeler/shared';

/**
 * フィールドの型に応じて適切な input を描画するコンポーネント。
 * optionsUrl が設定されている場合、外部 API から selectbox の選択肢を取得する。
 */
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // 必須フィールドは placeholder に「*」を付与し、aria-required を立てる。
  // ラベル列を持たない CRUD フォーム上でも視覚的に必須を伝えるための簡易表現。
  const placeholder = field.required ? `${field.label} *` : field.label;
  const common = {
    placeholder,
    'aria-required': field.required || undefined,
    'data-required': field.required ? 'true' : undefined,
  } as const;

  // optionsUrl が設定されている場合、selectbox として描画
  if (field.type === 'string' && field.optionsUrl) {
    return <SelectField field={field} value={value} onChange={onChange} />;
  }

  // reference が設定されている場合、外部モデルから selectbox の選択肢を取得する
  if (field.type === 'reference' && field.targetModel) {
    return <ReferenceField field={field} value={value} onChange={onChange} />;
  }

  switch (field.type) {
    case 'id':
      return (
        <input
          type="text"
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={true}
          placeholder={`${field.label} (自動採番)`}
          style={{ backgroundColor: '#f3f4f6', cursor: 'not-allowed' }}
        />
      );
    case 'reference':
    case 'string':
      return (
        <input
          type="text"
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          {...common}
          value={(value as number | '') ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'date': {
      const isAutoDate = field.defaultValue === 'today' || field.defaultOnUpdate === true;
      return (
        <input
          type="date"
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={isAutoDate}
          style={isAutoDate ? { backgroundColor: '#f3f4f6', cursor: 'not-allowed' } : undefined}
          title={isAutoDate ? '自動設定される日付のため編集できません' : undefined}
        />
      );
    }
    case 'boolean':
      return (
        <label>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            aria-required={field.required || undefined}
          />{' '}
          {field.label}
          {field.required && <span className="required-mark" aria-hidden="true"> *</span>}
        </label>
      );
  }
}

/**
 * optionsUrl から選択肢を取得して selectbox として描画するサブコンポーネント。
 * フェッチエラー時は text input にフォールバック。
 */
function SelectField({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!field.optionsUrl) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(field.optionsUrl!);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as unknown;
        if (!cancelled) {
          // レスポンス形式: string[] または { id, label }[]
          if (Array.isArray(data)) {
            const opts = data.map((item) => {
              if (typeof item === 'string') {
                return { id: item, label: item };
              }
              return item;
            });
            setOptions(opts as Array<{ id: string; label: string }>);
            setError(null);
          } else {
            throw new Error('Invalid response format');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [field.optionsUrl]);

  // エラーが出たら text input にフォールバック
  if (error) {
    return (
      <input
        type="text"
        placeholder={field.label}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        title={`Failed to load options: ${error}`}
      />
    );
  }

  return (
    <select
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      disabled={loading}
    >
      <option value="">-- 選択してください --</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/**
 * 参照先の API (/api/:targetModel) からレコード一覧を取得し、
 * 検索ボックス付き combobox として描画する。
 *
 * 既存挙動との互換性:
 * - 値の型は string (id) のまま。`onChange` は選択されたレコードの id を渡す。
 * - 未選択時は `undefined` を渡す。
 * - エラー時は text input にフォールバック。
 *
 * 検索仕様: targetLabelField (なければ id) に対する部分一致 (case-insensitive)。
 * 件数が多くなければクライアント側でフィルタするだけで十分。
 */
function ReferenceField({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!field.targetModel) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/${field.targetModel}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as Array<Record<string, unknown>>;
        if (!cancelled) {
          const opts = data.map((item) => ({
            id: String(item.id),
            label: field.targetLabelField ? String(item[field.targetLabelField] ?? item.id) : String(item.id),
          }));
          setOptions(opts);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [field.targetModel, field.targetLabelField]);

  // 外側クリックでポップオーバーを閉じる
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
  }, [options, query]);

  // エラーが出たら text input にフォールバック
  if (error) {
    return (
      <input
        type="text"
        placeholder={field.label}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        title={`Failed to load reference: ${error}`}
      />
    );
  }

  const currentId = (value as string) ?? '';
  const currentLabel = options.find((o) => o.id === currentId)?.label ?? '';
  const triggerText = loading
    ? '読み込み中...'
    : currentLabel || (currentId ? currentId : '-- 選択してください --');

  const pick = (opt: { id: string; label: string } | null) => {
    if (!opt) onChange(undefined);
    else onChange(opt.id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div
      ref={containerRef}
      className="ref-combobox"
      data-testid="ref-combobox"
      style={{ position: 'relative', display: 'inline-block', minWidth: '160px' }}
    >
      <button
        type="button"
        data-testid="ref-trigger"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '4px 8px',
          border: '1px solid #cbd5e1',
          borderRadius: 4,
          background: '#fff',
          font: 'inherit',
          cursor: loading ? 'not-allowed' : 'pointer',
          color: currentLabel ? 'inherit' : '#94a3b8',
        }}
      >
        {triggerText} <span style={{ float: 'right', color: '#94a3b8' }}>▾</span>
      </button>
      {/* 隠し select はテスト/フォームsubmit互換性のため */}
      <select
        aria-hidden="true"
        tabIndex={-1}
        value={currentId}
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      >
        <option value="">-- 選択してください --</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
      {open && (
        <div
          className="ref-popover"
          data-testid="ref-popover"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            width: 260,
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            padding: 6,
          }}
        >
          <input
            type="text"
            data-testid="ref-search"
            placeholder="検索..."
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => Math.min(filtered.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (filtered[focusIdx]) pick(filtered[focusIdx]); }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            }}
            style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 4, marginBottom: 6 }}
          />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto', flex: 1 }}>
            <li
              key="__clear__"
              data-testid="ref-option-empty"
              onClick={() => pick(null)}
              style={{ padding: '6px 8px', cursor: 'pointer', color: '#64748b', fontSize: '0.85em' }}
            >
              -- 選択をクリア --
            </li>
            {filtered.length === 0 ? (
              <li style={{ padding: 8, color: '#64748b', fontSize: '0.85em' }}>該当なし</li>
            ) : filtered.map((opt, i) => (
              <li
                key={opt.id}
                data-testid={`ref-option-${opt.id}`}
                onClick={() => pick(opt)}
                onMouseEnter={() => setFocusIdx(i)}
                style={{
                  padding: '6px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  background: i === focusIdx ? '#eff6ff' : 'transparent',
                  color: i === focusIdx ? '#2563eb' : 'inherit',
                  fontSize: 13,
                }}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
