import { useState } from 'react';
import type {
  ButtonDefinition,
  ModelDefinition,
  Record as ModelRecord,
} from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { FieldInput } from '../components/FieldInput.js';
import { SearchBar } from '../components/SearchBar.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useCrudViewModel } from '../viewmodels/useCrudViewModel.js';
import { buildRequestBody, TemplateError } from '../services/template.js';

/**
 * 単一モデルに対する CRUD 画面 (= マスタメンテナンス画面)。
 *
 * 機能:
 *   - 検索バー (キーワード + 詳細フィルタ + ソート)
 *   - 既存ボタン (作成/更新/編集/削除) は ui.builtinButtonOverrides で URL 差替え可能
 *   - カスタムボタン (scope=screen/row, kind=http) を ui.buttons で追加可能
 */

export function CrudView({ api, model }: { api: ApiClient; model: ModelDefinition }) {
  const vm = useCrudViewModel(api, model);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(model));
  const [confirm, setConfirm] = useState<{ message: string; onOk: () => void } | null>(null);
  const [actionError, setActionError] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const overrides = model.ui?.builtinButtonOverrides ?? {};
  const customButtons = model.ui?.buttons ?? [];
  const screenButtons = customButtons.filter((b) => b.scope === 'screen');
  const rowButtons = customButtons.filter((b) => b.scope === 'row');

  const startEdit = (record: ModelRecord) => {
    setEditingId(record.id);
    setForm({ ...record });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm(model));
  };

  const onSubmit = async () => {
    setActionError([]);
    if (editingId) {
      const ok = overrides.update
        ? await callOverride(api, overrides.update, { ...form, id: editingId }, setActionError)
        : await vm.update(editingId, form);
      if (ok) {
        cancelEdit();
        if (overrides.update) await vm.reload();
      }
    } else {
      const ok = overrides.create
        ? await callOverride(api, overrides.create, form, setActionError)
        : await vm.create(form);
      if (ok) {
        cancelEdit();
        if (overrides.create) await vm.reload();
      }
    }
  };

  const onDelete = async (id: string) => {
    setActionError([]);
    if (overrides.delete) {
      const ok = await callOverride(api, overrides.delete, { id }, setActionError);
      if (ok) await vm.reload();
    } else {
      await vm.remove(id);
    }
  };

  const runCustomButton = async (btn: ButtonDefinition, ctx: Record<string, unknown>) => {
    if (btn.action.kind !== 'http') return;
    const exec = async () => {
      setActionError([]);
      setActionNotice(null);
      try {
        const body = buildRequestBody(btn.action.kind === 'http' ? btn.action.bodyTemplate : undefined, ctx);
        // url にも {{}} 展開を許可
        const url = btn.action.kind === 'http' ? interpolateUrl(btn.action.url, ctx) : '';
        const res = await api.callCustom({
          method: btn.action.kind === 'http' ? btn.action.method : 'GET',
          url,
          body,
        });
        if (!res.ok) {
          setActionError([`HTTP ${res.status}: ${stringifyData(res.data)}`]);
          return;
        }
        setActionNotice(`「${btn.label}」を実行しました (HTTP ${res.status})`);
        if (btn.action.kind === 'http' && btn.action.openResponseInNewTab) {
          const w = window.open();
          if (w) {
            w.document.body.innerText = stringifyData(res.data);
          }
        }
        // データを変更しうるので一覧を再取得
        await vm.reload();
      } catch (e) {
        if (e instanceof TemplateError) setActionError([e.message]);
        else setActionError([String(e)]);
      }
    };

    const confirmMsg = btn.action.kind === 'http' ? btn.action.confirmMessage : undefined;
    if (confirmMsg) {
      setConfirm({
        message: confirmMsg,
        onOk: () => {
          setConfirm(null);
          void exec();
        },
      });
    } else {
      await exec();
    }
  };

  const sortIndicator = (name: string) =>
    vm.sortBy === name ? (vm.sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const ui = model.ui ?? {};
  const title = ui.listTitle ?? `${model.label} (${model.name})`;
  const createLabel = ui.createButtonLabel ?? '作成';
  const saveLabel = ui.saveButtonLabel ?? '更新';
  const cancelLabel = ui.cancelButtonLabel ?? 'キャンセル';

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '0 0 0.5rem' }} data-testid="crud-title">{title}</h2>
        <div className="row">
          {screenButtons.map((b) => (
            <button
              key={b.id}
              className={b.style ?? 'primary'}
              onClick={() => runCustomButton(b, {})}
              data-testid={`screen-button-${b.id}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {(vm.errors.length > 0 || actionError.length > 0) && (
        <div className="errors" role="alert">
          <ul>
            {vm.errors.map((e, i) => <li key={`v${i}`}>{e}</li>)}
            {actionError.map((e, i) => <li key={`a${i}`}>{e}</li>)}
          </ul>
        </div>
      )}
      {actionNotice && <div className="notice">{actionNotice}</div>}

      <SearchBar
        fields={model.fields}
        keyword={vm.keyword}
        filters={vm.filters}
        onKeywordChange={vm.setKeyword}
        onFiltersChange={vm.setFilters}
        hits={vm.filteredRecords.length}
        total={vm.records.length}
      />

      <div className="row" style={{ marginBottom: '0.6rem', marginTop: '0.6rem' }}>
        {model.fields.map((f) => (
          <FieldInput
            key={f.name}
            field={f}
            value={form[f.name]}
            onChange={(v) => setForm((prev) => ({ ...prev, [f.name]: v }))}
          />
        ))}
        <button className="primary" onClick={onSubmit} data-testid="submit-form">
          {editingId ? saveLabel : createLabel}
        </button>
        {editingId && (
          <button className="ghost" onClick={cancelEdit} data-testid="cancel-edit">
            {cancelLabel}
          </button>
        )}
      </div>

      <table>
        <thead>
          <tr>
            {model.fields.map((f) => (
              <th
                key={f.name}
                onClick={() => vm.toggleSort(f.name)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
                data-testid={`sort-${f.name}`}
                title="クリックでソート"
              >
                {f.label}{sortIndicator(f.name)}
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {vm.loading && (
            <tr><td colSpan={model.fields.length + 1} className="muted">読み込み中…</td></tr>
          )}
          {!vm.loading && vm.filteredRecords.length === 0 && (
            <tr><td colSpan={model.fields.length + 1} className="muted">レコードがありません</td></tr>
          )}
          {vm.filteredRecords.map((record) => (
            <tr key={record.id}>
              {model.fields.map((f) => (
                <td key={f.name}>{renderValue(record[f.name])}</td>
              ))}
              <td>
                <button className="ghost" onClick={() => startEdit(record)} data-testid={`edit-${record.id}`}>編集</button>{' '}
                <button className="danger" onClick={() => onDelete(record.id)} data-testid={`delete-${record.id}`}>削除</button>
                {rowButtons.map((b) => (
                  <span key={b.id}>
                    {' '}
                    <button
                      className={b.style ?? 'ghost'}
                      onClick={() => runCustomButton(b, record)}
                      data-testid={`row-button-${b.id}-${record.id}`}
                    >
                      {b.label}
                    </button>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={confirm !== null}
        message={confirm?.message ?? ''}
        onOk={() => confirm?.onOk()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function emptyForm(model: ModelDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) {
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

function interpolateUrl(url: string, ctx: Record<string, unknown>): string {
  return url.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    const v = ctx[key];
    return v === undefined || v === null ? '' : encodeURIComponent(String(v));
  });
}

function stringifyData(data: unknown): string {
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

async function callOverride(
  api: ApiClient,
  ov: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' },
  body: unknown,
  onError: (errs: string[]) => void,
): Promise<boolean> {
  try {
    const res = await api.callCustom({ method: ov.method, url: ov.url, body });
    if (!res.ok) {
      onError([`HTTP ${res.status}: ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`]);
      return false;
    }
    return true;
  } catch (e) {
    onError([e instanceof ApiError ? e.toMessages().join(', ') : String(e)]);
    return false;
  }
}
