import type { ModelerViewModel } from '../viewmodels/useModelerViewModel.js';
import { ModelEditor } from '../components/ModelEditor.js';

/**
 * モデル設計 View — 管理者モードのメインペイン。
 *
 * 仕事は「選択中のモデルを 1 つだけ ModelEditor で描画する」こと。
 * モデル一覧 / 追加 / モード切替 / グローバルツールバーは AppShell / Sidebar が
 * 担当する。本コンポーネントには表示と入力ハンドリング以外のロジックを置かない。
 */
export function ModelDesignerView({ vm }: { vm: ModelerViewModel }) {
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
          />
        </div>
      ) : (
        <p className="muted" data-testid="no-model-selected">
          左のリストからモデルを選択してください。
          {models.length === 0 && '（まだモデルがありません。「+ モデル追加」から開始）'}
        </p>
      )}
    </section>
  );
}
