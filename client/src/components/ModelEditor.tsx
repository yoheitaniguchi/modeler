import { Fragment, useState } from 'react';
import type {
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ModelUiConfig,
  RelationKind,
  ReferentialAction,
} from '@modeler/shared';
import { isValidIdentifier, RELATION_KINDS, REFERENTIAL_ACTIONS } from '@modeler/shared';
import { UiConfigEditor } from './UiConfigEditor.js';
import { ButtonsEditor } from './ButtonsEditor.js';
import { HelpTip } from './HelpTip.js';
import { SqlExportButton } from './SqlExportButton.js';

/**
 * 単一モデルの編集 UI。
 *  - ModelDesignerView (新規作成側) と DeployedModelsView の InlineModelEditor
 *    の両方で使い回す。
 *  - state は親が持ち、ここは onChange で patch を返すだけの presentational。
 *
 * インラインバリデーションは入力中の即時フィードバックを目的とし、
 * 共有層の `isValidIdentifier` を使ってサーバー側と判定基準を揃える。
 */

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'reference', 'id'];

const NAME_HINT = '英字始まり / 英数字とアンダースコアのみ。API パスや DB カラム名に使われます。';
const TYPE_HINT = 'string / number / boolean / date のいずれか。型を変えるとデフォルト値はクリアされます。';
const OPTIONS_URL_HINT =
  'string 型のセレクトボックス用。指定 URL の GET レスポンス (string[] または {id,label}[]) を選択肢に使います。';
const NUMBERING_URL_HINT =
  'id 型用の自動採番 API。GET レスポンス (テキストまたは {id,number,value,code} を含む JSON) を新しい ID として利用します。未指定時は UUID が自動設定されます。';

const RELATION_KIND_LABEL: Record<RelationKind, string> = {
  oneToOne: '1 : 1',
  oneToMany: '1 : N',
  manyToMany: 'N : N (未実装)',
};
const REFERENTIAL_ACTION_LABEL: Record<ReferentialAction, string> = {
  restrict: 'RESTRICT (参照があれば削除不可)',
  cascade: 'CASCADE (連鎖削除)',
  setNull: 'SET NULL (null 化)',
  noAction: 'NO ACTION (何もしない)',
};

export function ModelEditor({
  model,
  onChange,
  onRemoveModel,
  showRemoveModel = true,
  disableNameEdit = false,
  knownModelNames,
  showAdminToolbar = false,
  onUndo,
  onRedo,
  onSaveJson,
  onLoadJson,
  onDeploy,
  canUndo = false,
  canRedo = false,
  canDeploy = false,
}: {
  model: ModelDefinition;
  onChange: (next: ModelDefinition) => void;
  onRemoveModel?: () => void;
  showRemoveModel?: boolean;
  /** インライン編集時は name を変えないように true にする。 */
  disableNameEdit?: boolean;
  /** 参照先候補のモデル名一覧。指定すると targetModel が select になり、未知名の警告も出る。 */
  knownModelNames?: string[];
  showAdminToolbar?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onSaveJson?: () => void;
  onLoadJson?: () => void;
  onDeploy?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canDeploy?: boolean;
}) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false);
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
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: collapsed ? '0' : '1.2rem' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <button
            type="button"
            className="ghost"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "展開する" : "折りたたむ"}
            aria-label={collapsed ? "展開する" : "折りたたむ"}
            data-testid={`toggle-collapse-${model.name || 'unnamed'}`}
            style={{
              padding: '0.3rem 0.5rem',
              fontSize: '0.85rem',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              backgroundColor: '#f9fafb',
              color: '#4b5563',
              marginTop: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2rem',
              height: '2rem'
            }}
          >
            {collapsed ? '▶' : '▼'}
          </button>
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
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.2rem', marginRight: '1rem' }}>
            <input
              type="checkbox"
              checked={model.softDelete ?? false}
              onChange={(e) => updateModel({ softDelete: e.target.checked })}
            />
            論理削除を有効
          </label>
          <SqlExportButton model={model} />
          {showRemoveModel && onRemoveModel && (
            <button className="danger" onClick={onRemoveModel}>モデル削除</button>
          )}
          {showAdminToolbar && (
            <>
              <button
                type="button"
                className="ghost"
                onClick={onUndo}
                disabled={!canUndo}
                data-testid="undo"
                title="元に戻す (Ctrl+Z)"
              >
                ⟲ 元に戻す
              </button>
              <button
                type="button"
                className="ghost"
                onClick={onRedo}
                disabled={!canRedo}
                data-testid="redo"
                title="やり直す (Ctrl+Shift+Z)"
              >
                ⟳ やり直す
              </button>
              <button
                type="button"
                className="ghost"
                onClick={onSaveJson}
                data-testid="save-json"
                title="JSON 保存 (Ctrl+S)"
              >
                JSON 保存
              </button>
              <button
                type="button"
                className="ghost"
                onClick={onLoadJson}
                data-testid="load-json"
                title="JSON 読込 (Ctrl+O)"
              >
                JSON 読込
              </button>
              <button
                type="button"
                className="primary"
                onClick={onDeploy}
                disabled={!canDeploy}
                data-testid="deploy"
              >
                デプロイ
              </button>
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="fields-table-wrapper" style={{ overflowX: 'auto', width: '100%', marginBottom: '0.6rem' }}>
            <table className="fields-table" style={{ marginTop: '0.6rem', fontSize: '0.9rem', width: '100%', minWidth: '850px' }}>
        <thead>
          <tr>
            <th style={{ width: '13%' }}>
              name <HelpTip text={NAME_HINT} label="フィールド名のヘルプ" />
            </th>
            <th style={{ width: '13%' }}>label</th>
            <th style={{ width: '10%' }}>
              type <HelpTip text={TYPE_HINT} label="型のヘルプ" />
            </th>
            <th style={{ width: '6%' }}>必須</th>
            <th style={{ width: '7%' }}>主キー</th>
            <th style={{ width: '16%' }}>デフォルト値</th>
            <th style={{ width: '20%' }}>
              API連携 (選択肢 / 採番) <HelpTip text={`${OPTIONS_URL_HINT}\n\n${NUMBERING_URL_HINT}`} label="API連携のヘルプ" />
            </th>
            <th style={{ width: '15%' }}></th>
          </tr>
        </thead>
        <tbody>
          {model.fields.map((field, fi) => {
            const fNameError = fieldNameError(field.name, fi, model.fields);
            return (
              <Fragment key={fi}>
                <tr>
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
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={field.primaryKey ?? false}
                    onChange={(e) => {
                      const isPk = e.target.checked;
                      updateField(fi, {
                        primaryKey: isPk,
                        // 主キーなら必須も自動ONにする
                        required: isPk ? true : field.required,
                      });
                    }}
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
                  ) : field.type === 'id' ? (
                    <input
                      type="text"
                      value={field.numberingUrl ?? ''}
                      placeholder="/api/numbering"
                      onChange={(e) => updateField(fi, { numberingUrl: e.target.value || undefined })}
                      style={{ fontSize: '0.9rem' }}
                      data-testid={`field-numbering-url-${fi}`}
                    />
                  ) : (
                    <span className="muted" style={{ fontSize: '0.8rem' }}>(string型/id型のみ)</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="ghost"
                    onClick={() => setExpandedRow(expandedRow === fi ? null : fi)}
                    title="詳細設定"
                    aria-label="詳細設定"
                    data-testid={`field-settings-${fi}`}
                    style={{ fontSize: '0.85rem', padding: '0.2rem 0.35rem' }}
                  >⚙️</button>{' '}
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
              {expandedRow === fi && (
                <tr>
                  <td colSpan={8} style={{ backgroundColor: '#f9f9f9', padding: '0.8rem', borderBottom: '1px solid #ddd' }}>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                      {field.type === 'reference' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '280px' }}>
                          <strong>リレーション設定</strong>
                          <label style={{ fontSize: '0.85rem' }}>
                            参照先モデル名 (targetModel)
                            {knownModelNames ? (
                              <select
                                value={field.targetModel ?? ''}
                                onChange={(e) => updateField(fi, { targetModel: e.target.value || undefined })}
                                style={{ width: '100%', marginTop: '0.2rem' }}
                                data-testid={`field-target-model-${fi}`}
                              >
                                <option value="">(未選択)</option>
                                {knownModelNames.map((n) => (
                                  <option key={n} value={n}>{n}</option>
                                ))}
                                {field.targetModel && !knownModelNames.includes(field.targetModel) && (
                                  <option value={field.targetModel}>{field.targetModel} (未存在)</option>
                                )}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={field.targetModel ?? ''}
                                placeholder="e.g. department"
                                onChange={(e) => updateField(fi, { targetModel: e.target.value })}
                                style={{ width: '100%', marginTop: '0.2rem' }}
                              />
                            )}
                          </label>
                          {knownModelNames && field.targetModel && !knownModelNames.includes(field.targetModel) && (
                            <div className="inline-error" data-testid={`field-target-model-error-${fi}`}>
                              参照先モデル "{field.targetModel}" は存在しません
                            </div>
                          )}
                          <label style={{ fontSize: '0.85rem' }}>
                            表示ラベルフィールド (targetLabelField)
                            <input
                              type="text"
                              value={field.targetLabelField ?? ''}
                              placeholder="e.g. name"
                              onChange={(e) => updateField(fi, { targetLabelField: e.target.value })}
                              style={{ width: '100%', marginTop: '0.2rem' }}
                            />
                          </label>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.85rem', flex: 1, minWidth: '120px' }}>
                              カーディナリティ
                              <select
                                value={field.relationKind ?? ''}
                                onChange={(e) => updateField(fi, { relationKind: (e.target.value as RelationKind) || undefined })}
                                style={{ width: '100%', marginTop: '0.2rem' }}
                                data-testid={`field-relation-kind-${fi}`}
                              >
                                <option value="">(既定: 1 : N)</option>
                                {RELATION_KINDS.map((k) => (
                                  <option key={k} value={k} disabled={k === 'manyToMany'}>
                                    {RELATION_KIND_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label style={{ fontSize: '0.85rem', flex: 1, minWidth: '120px' }}>
                              削除時の挙動 (onDelete)
                              <select
                                value={field.onDelete ?? ''}
                                onChange={(e) => updateField(fi, { onDelete: (e.target.value as ReferentialAction) || undefined })}
                                style={{ width: '100%', marginTop: '0.2rem' }}
                                data-testid={`field-on-delete-${fi}`}
                              >
                                <option value="">(既定: RESTRICT)</option>
                                {REFERENTIAL_ACTIONS.map((a) => (
                                  <option key={a} value={a}>{REFERENTIAL_ACTION_LABEL[a]}</option>
                                ))}
                              </select>
                            </label>
                            <label style={{ fontSize: '0.85rem', flex: 1, minWidth: '120px' }}>
                              更新時の挙動 (onUpdate)
                              <select
                                value={field.onUpdate ?? ''}
                                onChange={(e) => updateField(fi, { onUpdate: (e.target.value as ReferentialAction) || undefined })}
                                style={{ width: '100%', marginTop: '0.2rem' }}
                                data-testid={`field-on-update-${fi}`}
                              >
                                <option value="">(既定: NO ACTION)</option>
                                {REFERENTIAL_ACTIONS.map((a) => (
                                  <option key={a} value={a}>{REFERENTIAL_ACTION_LABEL[a]}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>
                      )}
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '250px' }}>
                        <strong>バリデーション設定</strong>
                        {(field.type === 'string' || field.type === 'reference') && (
                          <>
                            <label style={{ fontSize: '0.85rem' }}>
                              正規表現 (pattern)
                              <input type="text" value={field.validation?.pattern ?? ''} placeholder="^\\d{3}-\\d{4}$" onChange={(e) => updateField(fi, { validation: { ...field.validation, pattern: e.target.value || undefined } })} style={{ width: '100%', marginTop: '0.2rem' }} />
                            </label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <label style={{ fontSize: '0.85rem', flex: 1 }}>
                                最小文字数
                                <input type="number" value={field.validation?.minLength ?? ''} onChange={(e) => updateField(fi, { validation: { ...field.validation, minLength: e.target.value ? Number(e.target.value) : undefined } })} style={{ width: '100%', marginTop: '0.2rem' }} />
                              </label>
                              <label style={{ fontSize: '0.85rem', flex: 1 }}>
                                最大文字数
                                <input type="number" value={field.validation?.maxLength ?? ''} onChange={(e) => updateField(fi, { validation: { ...field.validation, maxLength: e.target.value ? Number(e.target.value) : undefined } })} style={{ width: '100%', marginTop: '0.2rem' }} />
                              </label>
                            </div>
                          </>
                        )}
                        {field.type === 'number' && (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.85rem', flex: 1 }}>
                              最小値
                              <input type="number" value={field.validation?.min ?? ''} onChange={(e) => updateField(fi, { validation: { ...field.validation, min: e.target.value ? Number(e.target.value) : undefined } })} style={{ width: '100%', marginTop: '0.2rem' }} />
                            </label>
                            <label style={{ fontSize: '0.85rem', flex: 1 }}>
                              最大値
                              <input type="number" value={field.validation?.max ?? ''} onChange={(e) => updateField(fi, { validation: { ...field.validation, max: e.target.value ? Number(e.target.value) : undefined } })} style={{ width: '100%', marginTop: '0.2rem' }} />
                            </label>
                          </div>
                        )}
                        <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.2rem' }}>
                          <input type="checkbox" checked={field.validation?.unique ?? false} onChange={(e) => updateField(fi, { validation: { ...field.validation, unique: e.target.checked ? true : undefined } })} />
                          ユニーク制約 (重複禁止)
                        </label>
                      </div>

                      {field.type === 'string' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '200px' }}>
                          <strong>入力フォーマッタ</strong>
                          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <input type="checkbox" checked={field.formatters?.trim ?? false} onChange={(e) => updateField(fi, { formatters: { ...field.formatters, trim: e.target.checked ? true : undefined } })} />
                            前後の空白を自動削除 (trim)
                          </label>
                          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <input type="checkbox" checked={field.formatters?.fullWidthToHalfWidth ?? false} onChange={(e) => updateField(fi, { formatters: { ...field.formatters, fullWidthToHalfWidth: e.target.checked ? true : undefined } })} />
                            全角英数字を半角に変換
                          </label>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '200px' }}>
                        <strong>画面表示設定</strong>
                        <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <input
                            type="checkbox"
                            checked={field.showInList ?? true}
                            onChange={(e) => updateField(fi, { showInList: e.target.checked })}
                          />
                          一覧画面に表示する
                        </label>
                        <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <input
                            type="checkbox"
                            checked={field.showInDetail ?? true}
                            onChange={(e) => updateField(fi, { showInDetail: e.target.checked })}
                          />
                          詳細・編集画面に表示する
                        </label>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
            </tbody>
          </table>
        </div>
        <button className="ghost" onClick={addField} style={{ marginTop: '0.5rem' }}>
          + フィールド追加
        </button>

        <div style={{ marginTop: '0.8rem' }}>
          <UiConfigEditor ui={model.ui} onChange={setUi} />
        </div>
        <div style={{ marginTop: '0.4rem' }}>
          <ButtonsEditor ui={model.ui} onChange={setUi} />
        </div>
      </>
    )}
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
    case 'id':
      return (
        <span className="muted" style={{ fontSize: '0.85rem' }}>(自動採番)</span>
      );
    case 'reference':
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
  }
}
