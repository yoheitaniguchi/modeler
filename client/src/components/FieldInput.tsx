import { useEffect, useState } from 'react';
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
  const common = { placeholder: field.label } as const;

  // optionsUrl が設定されている場合、selectbox として描画
  if (field.type === 'string' && field.optionsUrl) {
    return <SelectField field={field} value={value} onChange={onChange} />;
  }

  switch (field.type) {
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
    case 'date':
      return (
        <input
          type="date"
          {...common}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <label>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />{' '}
          {field.label}
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
  const [options, setOptions] = useState<Array<{ id: string; label: string }>[]>([]);
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
