import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { useModelerViewModel } from '../viewmodels/useModelerViewModel.js';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';
import { downloadAsFile } from '../services/jsonIo.js';
import { loadMode, saveMode, type UiMode } from '../services/uiPrefs.js';
import { Sidebar } from './Sidebar.js';
import { ModelDesignerView } from '../views/ModelDesignerView.js';
import { CrudView } from '../views/CrudView.js';
import { InlineModelEditor } from './InlineModelEditor.js';
import { ConfirmDialog } from './ConfirmDialog.js';

/**
 * アプリケーション全体のシェル。
 *
 * 役割:
 *   - ヘッダー (タイトル + 管理者モード時はグローバルツールバー) を描画
 *   - 左サイドバー (モード切替 + 管理者用モデルリスト) を描画
 *   - メインペインを描画 (admin → ModelDesignerView, user → DeployedModelsView)
 *
 * ViewModel はここで 1 インスタンスだけ生存させる。モード切替で undo/redo
 * 履歴と下書きを失わないため。
 *
 * ユーザーモードのサイドバー (deployed model リンク) は Task 5 で実装する。
 * 現状は既存の DeployedModelsView (select 形式) をそのままマウントし、CRUD 系
 * の e2e テストを温存する。
 */

export function AppShell({ api }: { api: ApiClient }) {
  const vm = useModelerViewModel(api);
  const [mode, setMode] = useState<UiMode>(() => loadMode());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deployedModels, setDeployedModels] = useState<ModelDefinition[] | null>(null);
  const [deployedSelectedName, setDeployedSelectedName] = useState<string | null>(null);
  const [deployedLoading, setDeployedLoading] = useState(false);
  const [deployedEditing, setDeployedEditing] = useState(false);
  const [deployedSaving, setDeployedSaving] = useState(false);
  const [deployedEditErrors, setDeployedEditErrors] = useState<string[]>([]);
  const [deployedDeleteConfirm, setDeployedDeleteConfirm] = useState<string | null>(null);

  // モードを localStorage に同期
  useEffect(() => {
    saveMode(mode);
  }, [mode]);

  // ユーザーモードのとき、デプロイ済みモデルを読み込む
  const reloadDeployedModels = async () => {
    try {
      const m = await api.listModels();
      setDeployedModels(m);
    } catch (e) {
      console.error('Failed to reload deployed models:', e);
    }
  };

  useEffect(() => {
    if (mode !== 'user') return;
    setDeployedLoading(true);
    api.listModels().then(
      (m) => {
        setDeployedModels(m);
        if (m.length > 0 && !deployedSelectedName) {
          setDeployedSelectedName(m[0].name);
        }
        setDeployedLoading(false);
      },
      (e) => {
        console.error('Failed to load deployed models:', e);
        setDeployedLoading(false);
      },
    );
  }, [mode, api]);

  const onSave = () => {
    const json = vm.exportJson();
    if (json) downloadAsFile('model-definition.json', json, 'application/json');
  };
  const onLoadClick = () => fileInputRef.current?.click();
  const onLoadFile = async (file: File) => {
    const text = await file.text();
    vm.importJson(text);
  };
  const onDeploy = async () => { await vm.deploy(); };

  const onSaveEditDeployed = async (next: ModelDefinition) => {
    if (!deployedSelectedName) return;
    setDeployedSaving(true);
    setDeployedEditErrors([]);
    try {
      await api.updateModel(deployedSelectedName, next);
      await reloadDeployedModels();
      setDeployedEditing(false);
    } catch (e) {
      setDeployedEditErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
    } finally {
      setDeployedSaving(false);
    }
  };

  const onConfirmDeleteDeployed = async () => {
    if (!deployedDeleteConfirm) return;
    try {
      await api.deleteModel(deployedDeleteConfirm);
      if (deployedSelectedName === deployedDeleteConfirm) setDeployedSelectedName(null);
      setDeployedDeleteConfirm(null);
      await reloadDeployedModels();
    } catch (e) {
      console.error('Failed to delete model:', e);
      setDeployedDeleteConfirm(null);
    }
  };

  // キーボードショートカット — admin モードのみ有効
  const shortcuts = useMemo(
    () => ({
      'mod+s': onSave,
      'mod+o': onLoadClick,
      'mod+z': vm.undo,
      'mod+shift+z': vm.redo,
      'mod+y': vm.redo,
    }),
    // ViewModel の関数は安定参照なので依存に揃える
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vm.undo, vm.redo, vm.exportJson],
  );
  useKeyboardShortcuts(shortcuts, mode === 'admin');

  return (
    <div className="app-shell">
      <header className="top">
        <div className="top-left">
          <h1>Modeler — マスタメンテナンス開発ツール</h1>
          <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>v0.1</span>
        </div>
      </header>

      <div className="shell-body">
        <Sidebar
          mode={mode}
          onChangeMode={setMode}
          designModels={vm.document.models}
          selectedKey={vm.selectedKey}
          onSelect={vm.select}
          onAddModel={vm.addModel}
          onMoveModel={vm.moveModel}
          draftAvailable={vm.draftAvailable}
          onRestoreDraft={vm.restoreDraft}
          onDiscardDraft={vm.discardDraft}
          deployedModels={deployedModels}
          deployedSelectedName={deployedSelectedName}
          onDeployedSelect={setDeployedSelectedName}
          deployedLoading={deployedLoading}
        />

        <main className="main-pane">
          {mode === 'admin' && (
            <ModelDesignerView
              vm={vm}
              onSaveJson={onSave}
              onLoadJson={onLoadClick}
            />
          )}
          {mode === 'user' && (
            <>
              {deployedLoading && <p className="muted">読み込み中…</p>}
              {!deployedLoading && (!deployedModels || deployedModels.length === 0) && (
                <p className="muted">
                  デプロイされたモデルがありません。
                  <br />
                  左側のメニューから管理者モードへ切り替えて、モデルを作成・デプロイしてください。
                </p>
              )}
              {!deployedLoading && deployedModels && deployedSelectedName && (
                (() => {
                  const selected = deployedModels.find((m) => m.name === deployedSelectedName);
                  if (!selected) return null;
                  return (
                    <>


                      {deployedEditing && (
                        <InlineModelEditor
                          initial={selected}
                          onSave={onSaveEditDeployed}
                          onCancel={() => {
                            setDeployedEditing(false);
                            setDeployedEditErrors([]);
                          }}
                          saving={deployedSaving}
                          errors={deployedEditErrors}
                          knownModelNames={deployedModels.map((m) => m.name)}
                        />
                      )}

                      {!deployedEditing && <CrudView api={api} model={selected} />}

                      <ConfirmDialog
                        open={deployedDeleteConfirm !== null}
                        message={`モデル「${deployedDeleteConfirm}」を削除します。\nAPI エンドポイントは即時無効化されます (データファイルは残ります)。`}
                        okLabel="削除"
                        onOk={onConfirmDeleteDeployed}
                        onCancel={() => setDeployedDeleteConfirm(null)}
                      />
                    </>
                  );
                })()
              )}
            </>
          )}
        </main>
      </div>

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
  );
}
