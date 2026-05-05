import type {
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ModelUiConfig,
} from '@modeler/shared';
import { UiConfigEditor } from './UiConfigEditor.js';
import { ButtonsEditor } from './ButtonsEditor.js';

/**
 * 単一モデルの編集 UI。
 *  - ModelDesignerView (新規作成側) と DeployedModelsView の InlineModelEditor
 *    の両方で使い回す。
 *  - state は親が持ち、ここは onChange で patch を返すだけの presentational。
 */

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

export function ModelEditor({
  model,
  onChange,
  onRemoveModel,
  showRemoveModel = true,
  disableNameEdit = false,
}: {
  model: ModelDefinition;
  onChange: (next: ModelDefinition) => void;
  onRemoveModel?: () => void;
  showRemoveModel?: boolean;
  /** インライン編集時は name を変えないように true にする。 */
  disableNameEdit?: boolean;
}) {
  const updateModel = (patch: Partial<ModelDefinition>) => {
    onChange({ ...model, ...patch });
  };

  const updateField = (idx: number, patch: Partial<FieldDefinition>) => {
    onChange({
      ...model,
      fields: model.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    });
  };

  const removeField = (idx: number) => {
    onChange({ ...model, fields: model.fields.filter((_, i) => i !== idx) });
  };

  const addField = () => {
    onChange({
      ...model,
      fields: [
        ...model.fields,
        { name: '', label: '', type: 'string', required: false },
      ],
    });
  };

  const setUi = (next: ModelUiConfig) => {
    // 完全に空オブジェクトなら ui プロパティを落とす
    const isEmpty =
      Object.keys(next).length === 0 ||
      Object.values(next).every((v) => v === undefined);
    onChange({ ...model, ui: isEmpty ? undefined : next });
  };

  return (
    <div data-testid={`model-editor-${model.name || 'unnamed'}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <label>モデル名 <input
            type="text"
            value={model.name}
            placeholder="customer"
            disabled={disableNameEdit}
            onChange={(e) => updateModel({ name: e.target.value })}
          /></label>
          <label>ラベル <input
            type="text"
            value={model.label}
            placeholder="顧客"
            onChange={(e) => updateModel({ label: e.target.value })}
          /></label>
        </div>
        {showRemoveModel && onRemoveModel && (
          <button className="danger" onClick={onRemoveModel}>モデル削除</button>
        )}
      </div>

      <table style={{ marginTop: '0.6rem', fontSize: '0.9rem' }}>
        <thead>
          <tr>
            <th style={{ width: '16%' }}>name</th>
            <th style={{ width: '16%' }}>label</th>
            <th style={{ width: '14%' }}>type</th>
            <th style={{ width: '10%' }}>必須</th>
            <th style={{ width: '20%' }}>デフォルト値</th>
            <th style={{ width: '18%' }}>optionsUrl</th>
            <th style={{ width: '6%' }}></th>
          </tr>
        </thead>
        <tbody>
          {model.fields.map((field, fi) => (
            <tr key={fi}>
              <td>
                <input
                  type="text"
                  value={field.name}
                  placeholder="e.g., email"
                  onChange={(e) => updateField(fi, { name: e.target.value })}
                  style={{ fontSize: '0.9rem' }}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={field.label}
                  placeholder="e.g., メール"
                  onChange={(e) => updateField(fi, { label: e.target.value })}
                  style={{ fontSize: '0.9rem' }}
                />
              </td>
              <td>
                <select
                  value={field.type}
                  onChange={(e) => {
                    const newType = e.target.value as FieldType;
                    updateField(fi, {
                      type: newType,
                      optionsUrl: newType === 'string' ? field.optionsUrl : undefined,
                    });
                  }}
                  style={{ fontSize: '0.9rem' }}
                >
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(fi, { required: e.target.checked })}
                />
              </td>
              <td>
                <DefaultValueInput
                  field={field}
                  onChange={(v) => updateField(fi, { defaultValue: v })}
                />
              </td>
              <td>
                {field.type === 'string' ? (
                  <input
                    type="text"
                    value={field.optionsUrl ?? ''}
                    placeholder="/api/categories"
                    onChange={(e) => updateField(fi, { optionsUrl: e.target.value || undefined })}
                    style={{ fontSize: '0.9rem' }}
                  />
                ) : (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>(string型のみ)</span>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  className="danger"
                  onClick={() => removeField(fi)}
                  disabled={model.fields.length <= 1}
                  style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}
                >削除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost" onClick={addField} style={{ marginTop: '0.5rem' }}>
        + フィールド追加
      </button>

      <div style={{ marginTop: '0.8rem' }}>
        <UiConfigEditor ui={model.ui} onChange={setUi} />
      </div>
      <div style={{ marginTop: '0.4rem' }}>
        <ButtonsEditor ui={model.ui} onChange={setUi} />
      </div>
    </div>
  );
}

function DefaultValueInput({
  field,
  onChange,
}: {
  field: { type: FieldType; defaultValue?: unknown };
  onChange: (v: unknown) => void;
}) {
  const value = field.defaultValue;
  const clear = () => onChange(undefined);

  switch (field.type) {
    case 'string':
      return (
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="text"
            value={(value as string) ?? ''}
            placeholder="(なし)"
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            style={{ fontSize: '0.9rem', flex: 1 }}
          />
          {value !== undefined && <button className="ghost" onClick={clear} style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}>✕</button>}
        </div>
      );
    case 'number':
      return (
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="number"
            value={(value as number) ?? ''}
            placeholder="(なし)"
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            style={{ fontSize: '0.9rem', flex: 1 }}
          />
          {value !== undefined && <button className="ghost" onClick={clear} style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}>✕</button>}
        </div>
      );
    case 'date':
      return (
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            style={{ fontSize: '0.9rem', flex: 1 }}
          />
          {value !== undefined && <button className="ghost" onClick={clear} style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}>✕</button>}
        </div>
      );
    case 'boolean':
      return (
        <select
          value={value === undefined ? '' : String(value)}
          onChange={(e) => {
            if (e.target.value === '') onChange(undefined);
            else onChange(e.target.value === 'true');
          }}
          style={{ fontSize: '0.9rem' }}
        >
          <option value="">(なし)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
  }
}
