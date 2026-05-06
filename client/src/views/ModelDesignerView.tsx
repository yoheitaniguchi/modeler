import { useMemo, useRef } from 'react';
import type { ApiClient } from '../services/api.js';
import { downloadAsFile } from '../services/jsonIo.js';
import { useModelerViewModel } from '../viewmodels/useModelerViewModel.js';
import { ModelEditor } from '../components/ModelEditor.js';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';

/**
 * モデル設計 View。
 *
 * このコンポーネントには「ロジック」を一切書かないことを目指す:
 *   - 状態は ViewModel に持たせる
 *   - クリック時の処理も ViewModel のメソッドを呼ぶだけ
 * View の責務は「現在状態を画面に表示する」「ユーザー入力を ViewModel に伝える」のみ。
 *
 * キーボードショートカット (Ctrl+S/O/Z/Y) と「下書き復元」バナーはここで配線する。
 */
export function ModelDesignerView({ api }: { api: ApiClient }) {
  const vm = useModelerViewModel(api);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 「保存」ボタン: ViewModel から JSON 文字列を取得 → ファイル化
  const onSave = () => {
    const json = vm.exportJson();
    if (json) downloadAsFile('model-definition.json', json, 'application/json');
  };

  // 「読み込み」ボタン: 隠した <input type="file"> をプログラムからクリック
  const onLoadClick = () => fileInputRef.current?.click();
  const onLoadFile = async (file: File) => {
    const text = await file.text();
    vm.importJson(text);
  };

  const onDeploy = async () => { await vm.deploy(); };

  // ショートカット: 関数の参照が毎回変わると addEventListener が再登録され続けるため、
  // useMemo で安定化する。中身は最新状態をクロージャで参照する。
  const shortcuts = useMemo(
    () => ({
      'mod+s': onSave,
      'mod+o': onLoadClick,
      'mod+z': vm.undo,
      'mod+shift+z': vm.redo,
      'mod+y': vm.redo,
    }),
    // 依存は ViewModel の安定参照に揃える
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vm.undo, vm.redo, vm.exportJson],
  );
  useKeyboardShortcuts(shortcuts);

  const showDraftBanner = vm.draftAvailable && vm.document.models.length === 0;

  return (
    <section>
      <p className="muted">
        マスタメンテナンス画面のモデルを定義します。フィールドや「画面設定」「カスタムボタン」も
        含めて 1 つの JSON に保存・読込できます。完成したら「デプロイ」を押すと、定義通りの
        CRUD 画面と REST API が生成されます。
      </p>

      {showDraftBanner && (
        <div className="notice" data-testid="draft-banner" style={{ marginBottom: '0.6rem' }}>
          前回の編集途中の下書きが見つかりました。
          <button
            className="ghost"
            onClick={vm.restoreDraft}
            data-testid="restore-draft"
            style={{ marginLeft: '0.6rem' }}
          >
            復元
          </button>
          <button
            className="ghost"
            onClick={vm.discardDraft}
            data-testid="discard-draft"
            style={{ marginLeft: '0.3rem' }}
          >
            破棄
          </button>
        </div>
      )}

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="primary" onClick={vm.addModel} data-testid="add-model">+ モデル追加</button>
        <button
          className="ghost"
          onClick={vm.undo}
          disabled={!vm.canUndo}
          data-testid="undo"
          title="元に戻す (Ctrl+Z)"
        >
          ⟲ 元に戻す
        </button>
        <button
          className="ghost"
          onClick={vm.redo}
          disabled={!vm.canRedo}
          data-testid="redo"
          title="やり直す (Ctrl+Shift+Z)"
        >
          ⟳ やり直す
        </button>
        <button
          className="ghost"
          onClick={onSave}
          data-testid="save-json"
          title="JSON 保存 (Ctrl+S)"
        >
          JSON 保存
        </button>
        <button
          className="ghost"
          onClick={onLoadClick}
          data-testid="load-json"
          title="JSON 読込 (Ctrl+O)"
        >
          JSON 読込
        </button>
        <button
          className="primary"
          onClick={onDeploy}
          disabled={vm.document.models.length === 0}
          data-testid="deploy"
        >
          デプロイ
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          data-testid="load-json-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onLoadFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {vm.errors.length > 0 && (
        <div className="errors" role="alert">
          <strong>エラー:</strong>
          <ul>{vm.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {vm.notice && <div className="notice">{vm.notice}</div>}

      {vm.document.models.length === 0 && !showDraftBanner && (
        <p className="muted">まだモデルがありません。「+ モデル追加」から始めてください。</p>
      )}

      {vm.document.models.map((model, mi) => (
        <div className="card" key={mi}>
          <ModelEditor
            model={model}
            onChange={(next) => vm.replaceModel(mi, next)}
            onRemoveModel={() => vm.removeModel(mi)}
          />
        </div>
      ))}
    </section>
  );
}
