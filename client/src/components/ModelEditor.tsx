import type {
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ModelUiConfig,
} from '@modeler/shared';
import { isValidIdentifier } from '@modeler/shared';
import { UiConfigEditor } from './UiConfigEditor.js';
import { ButtonsEditor } from './ButtonsEditor.js';
import { HelpTip } from './HelpTip.js';

/**
 * 単一モデルの編集 UI。
 *  - ModelDesignerView (新規作成側) と DeployedModelsView の InlineModelEditor
 *    の両方で使い回す。
 *  - state は親が持ち、ここは onChange で patch を返すだけの presentational。
 *
 * インラインバリデーションは入力中の即時フィードバックを目的とし、
 * 共有層の `isValidIdentifier` を使ってサーバー側と判定基準を揃える。
 */

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

const NAME_HINT = '英字始まり / 英数字とアンダースコアのみ。API パスや DB カラム名に使われます。';
const TYPE_HINT = 'string / number / boolean / date のいずれか。型を変えるとデフォルト値はクリアされます。';
const OPTIONS_URL_HINT =
  'string 型のセレクトボックス用。指定 URL の GET レスポンス (string[] または {id,label}[]) を選択肢に使います。';

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

  const moveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= model.fields.length) return;
    const fields = [...model.fields];
    [fields[idx], fields[target]] = [fields[target], fields[idx]];
    onChange({ ...model, fields });
  };

  const duplicateField = (idx: number) => {
    const src = model.fields[idx];
    const candidateBase = src.name ? `${src.name}_copy` : 'field_copy';
    const existing = new Set(model.fields.map((f) => f.name));
    let name = candidateBase;
    let n = 2;
    while (existing.has(name)) {
      name = `${candidateBase}${n}`;
      n += 1;
    }
    const next = [...model.fields];
    next.splice(idx + 1, 0, { ...src, name });
    onChange({ ...model, fields: next });
  };

  const setUi = (next: ModelUiConfig) => {
    // 完全に空オブジェクトなら ui プロパティを落とす
    const isEmpty =
      Object.keys(next).length === 0 ||
      Object.values(next).every((v) => v === undefined);
    onChange({ ...model, ui: isEmpty ? undefined : next });
  };

  const modelNameError = nameError(model.name, disableNameEdit);
  const modelLabelError = labelError(model.label);

  return (
    <div data-testid={`model-editor-${model.name || 'unnamed'}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div>
            <label>
              モデル名 <HelpTip text={NAME_HINT} label="モデル名のヘルプ" />
              <input
                type="text"
                value={model.name}
                placeholder="customer"
                disabled={disableNameEdit}
                aria-invalid={modelNameError !== null}
                onChange={(e) => updateModel({ name: e.target.value })}
              />
            </label>
            {modelNameError && (
              <div className="inline-error" data-testid="model-name-error">{modelNameError}</div>
            )}
          </div>
          <div>
            <label>
              ラベル
              <input
                type="text"
                value={model.label}
                placeholder="顧客"
                aria-invalid={modelLabelError !== null}
                onChange={(e) => updateModel({ label: e.target.value })}
              />
            </label>
            {modelLabelError && (
              <div className="inline-error" data-testid="model-label-error">{modelLabelError}</div>
            )}
          </div>
        </div>
        {showRemoveModel && onRemoveModel && (
          <button className="danger" onClick={onRemoveModel}>モデル削除</button>
        )}
      </div>

      <table style={{ marginTop: '0.6rem', fontSize: '0.9rem' }}>
        <thead>
          <tr>
            <th style={{ width: '14%' }}>
              name <HelpTip text={NAME_HINT} label="フィールド名のヘルプ" />
            </th>
            <th style={{ width: '14%' }}>label</th>
            <th style={{ width: '12%' }}>
              type <HelpTip text={TYPE_HINT} label="型のヘルプ" />
            </th>
            <th style={{ width: '8%' }}>必須</th>
            <th style={{ width: '18%' }}>デフォルト値</th>
            <th style={{ width: '18%' }}>
              optionsUrl <HelpTip text={OPTIONS_URL_HINT} label="optionsUrl のヘルプ" />
            </th>
            <th style={{ width: '16%' }}></th>
          </tr>
        </thead>
        <tbody>
          {model.fields.map((field, fi) => {
            const fNameError = fieldNameError(field.name, fi, model.fields);
            return (
              <tr key={fi}>
                <td>
                  <input
                    type="text"
                    value={field.name}
                    placeholder="e.g., email"
                    aria-invalid={fNameError !== null}
                    onChange={(e) => updateField(fi, { name: e.target.value })}
                    style={{ fontSize: '0.9rem' }}
                  />
                  {fNameError && (
                    <div
                      className="inline-error"
                      data-testid={`field-name-error-${fi}`}
                    >
                      {fNameError}
                    </div>
                  )}
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
                        // 型が変わるとデフォルト値の意味が壊れるのでクリア
                        defaultValue: newType === field.type ? field.defaultValue : undefined,
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
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="ghost"
                    onClick={() => moveField(fi, -1)}
                    disabled={fi === 0}
                    title="上に移動"
                    aria-label="上に移動"
                    data-testid={`field-up-${fi}`}
                    style={{ fontSize: '0.85rem', padding: '0.2rem 0.35rem' }}
                  >↑</button>{' '}
                  <button
                    className="ghost"
                    onClick={() => moveField(fi, 1)}
                    disabled={fi === model.fields.length - 1}
                    title="下に移動"
                    aria-label="下に移動"
                    data-testid={`field-down-${fi}`}
                    style={{ fontSize: '0.85rem', padding: '0.2rem 0.35rem' }}
                  >↓</button>{' '}
                  <button
                    className="ghost"
                    onClick={() => duplicateField(fi)}
                    title="このフィールドを複製"
                    data-testid={`field-duplicate-${fi}`}
                    style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}
                  >複製</button>{' '}
                  <button
                    className="danger"
                    onClick={() => removeField(fi)}
                    disabled={model.fields.length <= 1}
                    style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}
                  >削除</button>
                </td>
              </tr>
            );
          })}
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

/** モデル名の即時検証。空欄は「これから入力」とみなしてエラーにしない。 */
function nameError(name: string, disabled: boolean): string | null {
  if (disabled) return null;
  if (name === '') return null;
  if (!isValidIdentifier(name)) return NAME_HINT;
  return null;
}

function labelError(label: string): string | null {
  if (label === '') return null;
  if (label.trim() === '') return 'ラベルは空白だけにできません';
  return null;
}

/** フィールド名の即時検証。重複もここで検出する。 */
function fieldNameError(
  name: string,
  index: number,
  fields: FieldDefinition[],
): string | null {
  if (name === '') return null;
  if (!isValidIdentifier(name)) return NAME_HINT;
  const dup = fields.some((f, i) => i !== index && f.name === name);
  if (dup) return '同じ名前のフィールドが既にあります';
  return null;
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
