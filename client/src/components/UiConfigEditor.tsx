import type { ModelUiConfig, ScreenLayout } from '@modeler/shared';
import { SCREEN_LAYOUTS } from '@modeler/shared';

/**
 * 画面定義 (タイトル/ボタンラベル/既存ボタンの URL 上書き) を編集する。
 * モデル単位で 1 つ表示する。
 */
export function UiConfigEditor({
  ui,
  onChange,
}: {
  ui: ModelUiConfig | undefined;
  onChange: (next: ModelUiConfig) => void;
}) {
  const u = ui ?? {};
  const update = (patch: Partial<ModelUiConfig>) => onChange({ ...u, ...patch });

  const overrides = u.builtinButtonOverrides ?? {};
  const setOverride = (
    key: 'create' | 'update' | 'delete',
    patch: Partial<{ url: string; method: string }>,
  ) => {
    const cur = overrides[key] ?? { url: '', method: 'POST' as const };
    const next = { ...cur, ...patch } as { url: string; method: string };
    if (next.url === '') {
      // 空にしたら override 解除
      const cleaned = { ...overrides };
      delete cleaned[key];
      update({ builtinButtonOverrides: cleaned });
      return;
    }
    update({
      builtinButtonOverrides: {
        ...overrides,
        [key]: next,
      },
    });
  };

  const LAYOUT_LABELS: Record<ScreenLayout, string> = {
    standard: 'standard — 単一CRUD (従来)',
    masterDetail: 'masterDetail — 上下分割 ヘッダー/明細',
  };

  return (
    <div className="ui-config-editor" data-testid="ui-config-editor">
      <details open>
        <summary><strong>画面パターン (レイアウト)</strong></summary>
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            画面パターン
            <select
              data-testid="layout-select"
              value={u.layout ?? 'standard'}
              onChange={(e) => {
                const v = e.target.value as ScreenLayout;
                update({ layout: v === 'standard' ? undefined : v });
              }}
            >
              {SCREEN_LAYOUTS.map((l) => (
                <option key={l} value={l}>{LAYOUT_LABELS[l]}</option>
              ))}
            </select>
          </label>
          {u.layout === 'masterDetail' && (
            <span className="muted" style={{ fontSize: '0.85em' }}>
              このモデルを <code>parent.model</code> で指す子モデルが 1 つ以上必要です。
            </span>
          )}
        </div>
      </details>

      <details>
        <summary><strong>画面設定 (タイトル・ボタンラベル)</strong></summary>
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <label>一覧タイトル <input
            type="text"
            value={u.listTitle ?? ''}
            onChange={(e) => update({ listTitle: e.target.value || undefined })}
          /></label>
          <label>作成ボタン <input
            type="text"
            value={u.createButtonLabel ?? ''}
            placeholder="作成"
            onChange={(e) => update({ createButtonLabel: e.target.value || undefined })}
          /></label>
          <label>保存ボタン <input
            type="text"
            value={u.saveButtonLabel ?? ''}
            placeholder="更新"
            onChange={(e) => update({ saveButtonLabel: e.target.value || undefined })}
          /></label>
          <label>キャンセル <input
            type="text"
            value={u.cancelButtonLabel ?? ''}
            placeholder="キャンセル"
            onChange={(e) => update({ cancelButtonLabel: e.target.value || undefined })}
          /></label>
        </div>
      </details>

      <details>
        <summary><strong>既存ボタンの送信先 URL 上書き</strong></summary>
        <p className="muted" style={{ margin: '0.4rem 0' }}>
          空欄ならデフォルト (`/api/&lt;model&gt;`) を使用。外部 API に向ける場合のみ設定。
        </p>
        {(['create', 'update', 'delete'] as const).map((op) => {
          const cur = overrides[op];
          return (
            <div className="row" key={op} style={{ marginTop: '0.3rem' }}>
              <label style={{ width: '4rem' }}>{op}</label>
              <select
                value={cur?.method ?? 'POST'}
                onChange={(e) => setOverride(op, { method: e.target.value })}
                style={{ width: '6rem' }}
              >
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="(デフォルト)"
                value={cur?.url ?? ''}
                onChange={(e) => setOverride(op, { url: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>
          );
        })}
      </details>
    </div>
  );
}
