import { useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import { ModelEditor } from './ModelEditor.js';

/**
 * デプロイ済みモデルのインライン編集 UI。
 *  - 既存定義をコピーして編集 → 「保存」で再デプロイ。
 *  - name は変更不可 (URL/データファイルパスに使われるため)。
 */
export function InlineModelEditor({
  initial,
  onSave,
  onCancel,
  saving,
  errors,
  knownModelNames,
}: {
  initial: ModelDefinition;
  onSave: (next: ModelDefinition) => void;
  onCancel: () => void;
  saving: boolean;
  errors: string[];
  knownModelNames?: string[];
}) {
  const [draft, setDraft] = useState<ModelDefinition>(() => structuredClone(initial));

  return (
    <div className="card" data-testid="inline-model-editor" style={{ borderColor: '#2563eb' }}>
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong>「{initial.label}」の定義を編集</strong>
        <span className="muted">(name は変更不可)</span>
        <div style={{ marginLeft: 'auto' }} className="row">
          <button className="primary" onClick={() => onSave(draft)} disabled={saving} data-testid="save-inline-edit">
            {saving ? '保存中…' : '保存して再デプロイ'}
          </button>
          <button className="ghost" onClick={onCancel} disabled={saving} data-testid="cancel-inline-edit">
            キャンセル
          </button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="errors" role="alert">
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <ModelEditor
        model={draft}
        onChange={setDraft}
        showRemoveModel={false}
        disableNameEdit
        knownModelNames={knownModelNames}
      />
    </div>
  );
}
