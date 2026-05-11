import { useCallback, useEffect, useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { CrudView } from './CrudView.js';
import { InlineModelEditor } from '../components/InlineModelEditor.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';

/**
 * デプロイ済みモデルの一覧 → 選択 → CRUD 画面表示。
 *
 * + デプロイ済みモデルの「定義編集 (再デプロイ)」「削除」をここから直接行えるようにする。
 */
export function DeployedModelsView({ api }: { api: ApiClient }) {
  const [models, setModels] = useState<ModelDefinition[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const m = await api.listModels();
      setModels(m);
    } catch (e) {
      setError(String(e));
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api.listModels().then(
      (m) => { if (!cancelled) setModels(m); },
      (e) => { if (!cancelled) setError(String(e)); },
    );
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div className="errors">{error}</div>;
  if (models === null) return <p className="muted">読み込み中…</p>;
  if (models.length === 0) {
    return (
      <p className="muted">
        まだデプロイされたモデルがありません。「モデル設計」タブでモデルを定義し、
        「デプロイ」ボタンを押してください。
      </p>
    );
  }

  const current = models.find((m) => m.name === selected);

  const onSaveEdit = async (next: ModelDefinition) => {
    if (!current) return;
    setSaving(true);
    setEditErrors([]);
    try {
      await api.updateModel(current.name, next);
      await reload();
      setEditing(false);
    } catch (e) {
      setEditErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteModel(deleteConfirm);
      if (selected === deleteConfirm) setSelected(null);
      setDeleteConfirm(null);
      await reload();
    } catch (e) {
      setError(String(e));
      setDeleteConfirm(null);
    }
  };

  return (
    <section>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <label>モデル <select
          value={selected ?? ''}
          onChange={(e) => {
            setSelected(e.target.value || null);
            setEditing(false);
          }}
          data-testid="model-select"
        >
          <option value="">選択してください</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>{m.label} ({m.name})</option>
          ))}
        </select></label>

      </div>

      {current && editing && (
        <InlineModelEditor
          initial={current}
          onSave={onSaveEdit}
          onCancel={() => { setEditing(false); setEditErrors([]); }}
          saving={saving}
          errors={editErrors}
          knownModelNames={models.map((m) => m.name)}
        />
      )}

      {current && !editing && <CrudView api={api} model={current} />}

      <ConfirmDialog
        open={deleteConfirm !== null}
        message={`モデル「${deleteConfirm}」を削除します。\nAPI エンドポイントは即時無効化されます (データファイルは残ります)。`}
        okLabel="削除"
        onOk={onConfirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </section>
  );
}
