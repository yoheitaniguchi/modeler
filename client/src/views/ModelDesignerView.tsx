import type { ModelerViewModel } from '../viewmodels/useModelerViewModel.js';
import { ModelEditor } from '../components/ModelEditor.js';

/**
 * モデル設計 View — 管理者モードのメインペイン。
 *
 * 仕事は「選択中のモデルを 1 つだけ ModelEditor で描画する」こと。
 * モデル一覧 / 追加 / モード切替 / グローバルツールバーは AppShell / Sidebar が
 * 担当する。本コンポーネントには表示と入力ハンドリング以外のロジックを置かない。
 */
export function ModelDesignerView({
  vm,
  onSaveJson,
  onLoadJson,
}: {
  vm: ModelerViewModel;
  onSaveJson: () => void;
  onLoadJson: () => void;
}) {
  const models = vm.document.models;
  const selectedIndex = models.findIndex((m) => m.__clientId === vm.selectedKey);
  const selected = selectedIndex >= 0 ? models[selectedIndex] : null;

  return (
    <section className="model-designer">
      {vm.errors.length > 0 && (
        <div className="errors" role="alert">
          <strong>エラー:</strong>
          <ul>{vm.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {vm.notice && <div className="notice">{vm.notice}</div>}

      {selected ? (
        <div className="card model-design-card">
          <ModelEditor
            model={selected}
            onChange={(next) => vm.replaceModel(selectedIndex, next)}
            onRemoveModel={() => vm.removeModel(selectedIndex)}
            knownModelNames={models.map((m) => m.name).filter((n) => n !== '')}
            showAdminToolbar={true}
            onUndo={vm.undo}
            onRedo={vm.redo}
            onSaveJson={onSaveJson}
            onLoadJson={onLoadJson}
            onDeploy={vm.deploy}
            canUndo={vm.canUndo}
            canRedo={vm.canRedo}
            canDeploy={models.length > 0}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="row" style={{ justifyContent: 'flex-end', gap: '0.4rem', marginBottom: '0.5rem' }}>
            <button
              type="button"
              className="ghost"
              onClick={onLoadJson}
              data-testid="load-json"
              title="JSON 読込 (Ctrl+O)"
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.85rem',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              JSON 読込
            </button>
          </div>
          <p className="muted" data-testid="no-model-selected" style={{ marginTop: 0 }}>
            左のリストからモデルを選択してください。
            {models.length === 0 && '（まだモデルがありません。「+ モデル追加」から開始）'}
          </p>
        </div>
      )}
    </section>
  );
}
