import { useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import type { UiMode } from '../services/uiPrefs.js';
import { ModelRowKebab } from './ModelRowKebab.js';

/**
 * 左サイドバー。
 *
 * 最上部にモード切替トグル → モードに応じたコンテンツを下に並べる。
 * 管理者モードのときだけ「データモデル定義」リスト + 「+ モデル追加」を出す。
 * ユーザーモードのコンテンツ (デプロイ済みモデルのリンク化) は Task 5 で実装する。
 *
 * 並び替え UI は Task 4、定義編集/削除のケバブメニューは Task 6 で追加する。
 */

export interface SidebarProps {
  mode: UiMode;
  onChangeMode: (next: UiMode) => void;

  // 管理者モード用
  designModels: ModelDefinition[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onAddModel: () => void;
  onMoveModel: (from: number, to: number) => void;
  draftAvailable: boolean;
  onRestoreDraft: () => void;
  onDiscardDraft: () => void;

  // ユーザーモード用
  deployedModels: ModelDefinition[] | null;
  deployedSelectedName: string | null;
  onDeployedSelect: (name: string) => void;
  deployedLoading?: boolean;
}

export function Sidebar({
  mode,
  onChangeMode,
  designModels,
  selectedKey,
  onSelect,
  onAddModel,
  onMoveModel,
  draftAvailable,
  onRestoreDraft,
  onDiscardDraft,
  deployedModels,
  deployedSelectedName,
  onDeployedSelect,
  deployedLoading = false,
}: SidebarProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  return (
    <aside className={`sidebar ${isMinimized ? 'is-minimized' : ''}`} data-testid="sidebar">
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: isMinimized ? 'center' : 'flex-end', paddingBottom: '0.2rem' }}>
        <button
          type="button"
          className="burger-menu-btn"
          onClick={() => setIsMinimized(!isMinimized)}
          data-testid="sidebar-toggle-minimize"
          title={isMinimized ? "サイドバーを展開" : "サイドバーを最小化"}
          aria-label={isMinimized ? "サイドバーを展開" : "サイドバーを最小化"}
        >
          ☰
        </button>
      </div>

      <div className="mode-toggle" role="tablist" aria-label="モード切替">
        <button
          role="tab"
          aria-selected={mode === 'admin'}
          className={mode === 'admin' ? 'active' : ''}
          onClick={() => onChangeMode('admin')}
          data-testid="mode-admin"
        >
          管理者
        </button>
        <button
          role="tab"
          aria-selected={mode === 'user'}
          className={mode === 'user' ? 'active' : ''}
          onClick={() => onChangeMode('user')}
          data-testid="mode-user"
        >
          マスタ管理
        </button>
      </div>

      {mode === 'admin' && (
        <div className="sidebar-section" data-testid="sidebar-admin">
          <h2 className="sidebar-heading">データモデル定義</h2>
          <button
            className="primary sidebar-add"
            onClick={onAddModel}
            data-testid="add-model"
          >
            + モデル追加
          </button>

          {draftAvailable && designModels.length === 0 && (
            <div className="notice sidebar-draft" data-testid="draft-banner">
              前回の編集途中の下書きがあります。
              <div className="row" style={{ marginTop: '0.4rem' }}>
                <button
                  className="ghost"
                  onClick={onRestoreDraft}
                  data-testid="restore-draft"
                >
                  復元
                </button>
                <button
                  className="ghost"
                  onClick={onDiscardDraft}
                  data-testid="discard-draft"
                >
                  破棄
                </button>
              </div>
            </div>
          )}

          {designModels.length === 0 ? (
            <p className="muted sidebar-empty">
              「+ モデル追加」から始めてください。
            </p>
          ) : (
            <>
              <ul className="model-list" data-testid="model-list">
                {designModels.map((m, idx) => {
                  const key = m.__clientId ?? m.name;
                  const isSelected = key === selectedKey;
                  const label = m.label?.trim() || '(無題)';
                  const subtitle = m.name?.trim() ? `(${m.name})` : '(新規)';
                  const rowKey = m.name?.trim() || key;
                  return (
                    <li
                      key={key}
                      className={isSelected ? 'model-list-item is-selected' : 'model-list-item'}
                    >
                      <button
                        className="model-link"
                        onClick={() => onSelect(key)}
                        data-testid={`model-link-${m.name || key}`}
                        aria-current={isSelected}
                      >
                        <span className="model-link-label">{label}</span>
                        <span className="model-link-sub">{subtitle}</span>
                      </button>
                      <ModelRowKebab
                        rowKey={rowKey}
                        isFirst={idx === 0}
                        isLast={idx === designModels.length - 1}
                        onMoveUp={() => onMoveModel(idx, idx - 1)}
                        onMoveDown={() => onMoveModel(idx, idx + 1)}
                      />
                    </li>
                  );
                })}
              </ul>
              <p className="muted reorder-hint" data-testid="reorder-hint">
                ⓘ 並び順の変更はデプロイ後にマスタ管理へ反映されます。
              </p>
            </>
          )}
        </div>
      )}

      {mode === 'user' && (
        <div className="sidebar-section" data-testid="sidebar-user">
          <h2 className="sidebar-heading">マスタ管理</h2>
          {deployedLoading && <p className="muted">読み込み中…</p>}
          {!deployedLoading && (!deployedModels || deployedModels.length === 0) && (
            <p className="muted sidebar-empty">
              デプロイされたモデルがありません。
              <br />
              管理者モードへ切り替えて、モデルを作成・デプロイしてください。
            </p>
          )}
          {!deployedLoading && deployedModels && deployedModels.length > 0 && (
            <ul className="model-list" data-testid="deployed-model-list">
              {deployedModels.map((m) => {
                const label = m.label?.trim() || '(無題)';
                const subtitle = m.name?.trim() ? `(${m.name})` : '(新規)';
                const isSelected = m.name === deployedSelectedName;
                return (
                  <li
                    key={m.name}
                    className={isSelected ? 'model-list-item is-selected' : 'model-list-item'}
                  >
                    <button
                      className="model-link"
                      onClick={() => onDeployedSelect(m.name)}
                      data-testid={`deployed-model-link-${m.name}`}
                      aria-current={isSelected}
                    >
                      <span className="model-link-label">{label}</span>
                      <span className="model-link-sub">{subtitle}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
