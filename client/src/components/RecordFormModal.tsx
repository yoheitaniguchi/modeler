import { useEffect, useState } from 'react';
import type { ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import { FieldInput } from './FieldInput.js';

export function RecordFormModal({
  open,
  model,
  initialRecord,
  isEdit,
  saving,
  errors,
  onSave,
  onCancel,
}: {
  open: boolean;
  model: ModelDefinition;
  initialRecord: ModelRecord | null;
  isEdit: boolean;
  saving: boolean;
  errors: string[];
  onSave: (form: Record<string, unknown>, keepOpen: boolean) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(model));

  useEffect(() => {
    if (!open) return;
    if (initialRecord) {
      setForm({ ...initialRecord });
    } else {
      setForm(emptyForm(model));
    }
  }, [open, initialRecord, model]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isNewRecord = !isEdit;
  const title = isNewRecord ? `${model.label}を新規作成` : `${model.label}を編集`;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" data-testid="record-form-modal">
      <div className="modal modal--wide">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div className="row">
            <button
              className="primary"
              onClick={() => onSave(form, false)}
              disabled={saving}
              data-testid="modal-save-and-close"
            >
              登録して閉じる
            </button>
            <button
              className="ghost"
              onClick={() => onSave(form, true)}
              disabled={saving}
              data-testid="modal-save-and-continue"
            >
              登録してもう一件登録する
            </button>
            <button
              className="ghost"
              onClick={onCancel}
              disabled={saving}
              data-testid="modal-cancel"
            >
              キャンセル
            </button>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="errors" role="alert" data-testid="modal-errors">
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-grid">
          {model.fields.filter((f) => f.showInDetail !== false).map((f) => {
            const isRequired = f.required || f.primaryKey === true;
            return (
              <div key={f.name} className="field-group">
                <label style={{ color: isRequired ? '#dc2626' : '#555' }}>
                  {f.label}
                  {isRequired && <span style={{ color: '#dc2626', marginLeft: '0.2rem' }}>*</span>}
                </label>
                <FieldInput
                  field={f}
                  value={form[f.name]}
                  onChange={(v) => setForm((prev) => ({ ...prev, [f.name]: v }))}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getTodayString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function emptyForm(model: ModelDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) {
    if (f.defaultValue !== undefined) {
      if (f.type === 'date' && f.defaultValue === 'today') {
        out[f.name] = getTodayString();
      } else {
        out[f.name] = f.defaultValue;
      }
    } else {
      out[f.name] = f.type === 'boolean' ? false : '';
    }
  }
  return out;
}
