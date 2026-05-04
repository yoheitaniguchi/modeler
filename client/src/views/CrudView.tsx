import { useState } from 'react';
import type { FieldDefinition, ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { useCrudViewModel } from '../viewmodels/useCrudViewModel.js';

/**
 * 単一モデルに対する CRUD 画面。
 * direction.xml の「画面と CRUD 操作用ボタン」がここに該当する。
 *
 * ポイント:
 *   - 編集中レコードの状態 (editing) は「画面ローカルな関心事」なので
 *     ViewModel ではなく useState で持つ。ViewModel に何でも詰め込まないことが
 *     肝心 (それぞれの状態を「どこに置くと再利用しやすいか」で考える)。
 */

export function CrudView({ api, model }: { api: ApiClient; model: ModelDefinition }) {
  const vm = useCrudViewModel(api, model);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(model));

  const startEdit = (record: ModelRecord) => {
    setEditingId(record.id);
    setForm({ ...record });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm(model));
  };

  const onSubmit = async () => {
    const ok = editingId
      ? await vm.update(editingId, form)
      : await vm.create(form);
    if (ok) cancelEdit();
  };

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 0.5rem' }}>{model.label} ({model.name})</h2>

      {vm.errors.length > 0 && (
        <div className="errors" role="alert">
          <ul>{vm.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div className="row" style={{ marginBottom: '0.6rem' }}>
        {model.fields.map((f) => (
          <FieldInput
            key={f.name}
            field={f}
            value={form[f.name]}
            onChange={(v) => setForm((prev) => ({ ...prev, [f.name]: v }))}
          />
        ))}
        <button className="primary" onClick={onSubmit}>
          {editingId ? '更新' : '作成'}
        </button>
        {editingId && <button className="ghost" onClick={cancelEdit}>キャンセル</button>}
      </div>

      <table>
        <thead>
          <tr>
            {model.fields.map((f) => <th key={f.name}>{f.label}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {vm.loading && (
            <tr><td colSpan={model.fields.length + 1} className="muted">読み込み中…</td></tr>
          )}
          {!vm.loading && vm.records.length === 0 && (
            <tr><td colSpan={model.fields.length + 1} className="muted">レコードがありません</td></tr>
          )}
          {vm.records.map((record) => (
            <tr key={record.id}>
              {model.fields.map((f) => (
                <td key={f.name}>{renderValue(record[f.name])}</td>
              ))}
              <td>
                <button className="ghost" onClick={() => startEdit(record)}>編集</button>{' '}
                <button className="danger" onClick={() => vm.remove(record.id)}>削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function emptyForm(model: ModelDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) {
    // defaultValue が指定されていれば使う。なければ型別の初期値。
    if (f.defaultValue !== undefined) {
      out[f.name] = f.defaultValue;
    } else {
      out[f.name] = f.type === 'boolean' ? false : '';
    }
  }
  return out;
}

function renderValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * フィールドの型に応じて適切な input を出す小コンポーネント。
 * ここを 1 箇所にまとめておくと、サポート型を追加するときの修正範囲が最小になる。
 */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const common = { placeholder: field.label } as const;
  switch (field.type) {
    case 'string':
      return (
        <input type="text" {...common} value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    case 'number':
      return (
        <input type="number" {...common} value={(value as number | '') ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      );
    case 'date':
      return (
        <input type="date" {...common} value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    case 'boolean':
      return (
        <label>
          <input type="checkbox" checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
  }
}
