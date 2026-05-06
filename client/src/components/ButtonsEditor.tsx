import type { ButtonDefinition, ModelUiConfig } from '@modeler/shared';
import { HelpTip } from './HelpTip.js';

/**
 * カスタムボタン (HTTP 呼び出し) の定義を追加・編集・削除する UI。
 */
export function ButtonsEditor({
  ui,
  onChange,
}: {
  ui: ModelUiConfig | undefined;
  onChange: (next: ModelUiConfig) => void;
}) {
  const buttons = ui?.buttons ?? [];

  const setButtons = (next: ButtonDefinition[]) => {
    onChange({ ...(ui ?? {}), buttons: next });
  };

  const addButton = () => {
    setButtons([
      ...buttons,
      {
        id: `btn${buttons.length + 1}`,
        label: '新規ボタン',
        scope: 'screen',
        style: 'primary',
        action: { kind: 'http', method: 'POST', url: '' },
      },
    ]);
  };

  const updateButton = (idx: number, patch: Partial<ButtonDefinition>) => {
    setButtons(buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const updateAction = (idx: number, patch: Record<string, unknown>) => {
    setButtons(
      buttons.map((b, i) => (i === idx ? { ...b, action: { ...b.action, ...patch } as ButtonDefinition['action'] } : b)),
    );
  };

  const removeButton = (idx: number) => {
    setButtons(buttons.filter((_, i) => i !== idx));
  };

  return (
    <div className="buttons-editor" data-testid="buttons-editor">
      <details open={buttons.length > 0}>
        <summary><strong>カスタムボタン (REST API 呼び出し)</strong></summary>
        <p className="muted" style={{ margin: '0.4rem 0' }}>
          画面ヘッダ (screen) または各行 (row) に表示するボタンを追加できます。
          bodyTemplate では <code>{'{{fieldName}}'}</code> を行データの値で置換可能。
        </p>
        {buttons.map((btn, i) => {
          const a = btn.action;
          return (
            <div key={i} className="card" style={{ background: '#f9fafb', padding: '0.6rem' }} data-testid={`button-row-${i}`}>
              <div className="row">
                <label>
                  ID <HelpTip text="モデル内で一意。英字始まり / 英数字・ハイフン・アンダースコアのみ。" label="ID のヘルプ" />
                  <input
                    type="text"
                    value={btn.id}
                    onChange={(e) => updateButton(i, { id: e.target.value })}
                    style={{ width: '7rem' }}
                  />
                </label>
                <label>ラベル <input
                  type="text"
                  value={btn.label}
                  onChange={(e) => updateButton(i, { label: e.target.value })}
                  style={{ width: '8rem' }}
                /></label>
                <label>
                  スコープ <HelpTip text="screen=画面ヘッダに 1 つ表示 / row=各行ごとに表示。row では行データを {{name}} で参照可。" label="スコープのヘルプ" />
                  <select
                    value={btn.scope}
                    onChange={(e) => updateButton(i, { scope: e.target.value as 'row' | 'screen' })}
                  >
                    <option value="screen">画面</option>
                    <option value="row">行</option>
                  </select>
                </label>
                <label>
                  スタイル <HelpTip text="primary=青 / danger=赤 / ghost=白枠。誤操作リスクのある動作は danger を推奨。" label="スタイルのヘルプ" />
                  <select
                    value={btn.style ?? 'primary'}
                    onChange={(e) => updateButton(i, { style: e.target.value as 'primary' | 'danger' | 'ghost' })}
                  >
                    <option value="primary">primary</option>
                    <option value="danger">danger</option>
                    <option value="ghost">ghost</option>
                  </select>
                </label>
                <button className="danger" onClick={() => removeButton(i)} style={{ marginLeft: 'auto' }}>
                  削除
                </button>
              </div>

              {a.kind === 'http' && (
                <>
                  <div className="row" style={{ marginTop: '0.4rem' }}>
                    <label>Method <select
                      value={a.method}
                      onChange={(e) => updateAction(i, { method: e.target.value })}
                      style={{ width: '6rem' }}
                    >
                      {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select></label>
                    <label style={{ flex: 1 }}>
                      URL <HelpTip text="送信先。{{fieldName}} で行データの値を URL エンコードして埋め込めます。例: /api/customer/{{id}}/notify" label="URL のヘルプ" />
                      <input
                        type="text"
                        value={a.url}
                        onChange={(e) => updateAction(i, { url: e.target.value })}
                        placeholder="/api/customer/{{id}}/notify"
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                  <div className="row" style={{ marginTop: '0.4rem' }}>
                    <label style={{ flex: 1 }}>
                      bodyTemplate (JSON) <HelpTip text="リクエストボディの雛形。{{fieldName}} を行データで置換します。空欄ならボディなし。" label="bodyTemplate のヘルプ" />
                      <textarea
                        value={a.bodyTemplate ?? ''}
                        onChange={(e) => updateAction(i, { bodyTemplate: e.target.value || undefined })}
                        placeholder='{"id":"{{id}}","name":"{{name}}"}'
                        rows={2}
                        style={{ width: '100%', fontFamily: 'monospace' }}
                      />
                    </label>
                  </div>
                  <div className="row" style={{ marginTop: '0.4rem' }}>
                    <label>
                      確認メッセージ <HelpTip text="設定すると押下時に確認ダイアログを表示します。破壊的操作は必ず設定推奨。" label="確認メッセージのヘルプ" />
                      <input
                        type="text"
                        value={a.confirmMessage ?? ''}
                        onChange={(e) => updateAction(i, { confirmMessage: e.target.value || undefined })}
                        placeholder="(なし)"
                        style={{ width: '20rem' }}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(a.openResponseInNewTab)}
                        onChange={(e) => updateAction(i, { openResponseInNewTab: e.target.checked || undefined })}
                      />{' '}レスポンスを新規タブで開く
                    </label>
                  </div>
                </>
              )}
            </div>
          );
        })}
        <button className="ghost" onClick={addButton} style={{ marginTop: '0.5rem' }} data-testid="add-button">
          + ボタン追加
        </button>
      </details>
    </div>
  );
}
