import { useMemo, useState } from 'react';
import { HttpApiClient } from '../services/api.js';
import { ModelDesignerView } from './ModelDesignerView.js';
import { DeployedModelsView } from './DeployedModelsView.js';

/**
 * ルートコンポーネント。
 *
 * 設計画面 / デプロイ済みモデルの操作画面の 2 つを上部タブで切替。
 * 「ツール部分」と「ツールが生成した画面部分」を分けることで、エンドユーザーが
 * 今どちらを使っているかを認識しやすくしている。
 */
export function App() {
  const api = useMemo(() => new HttpApiClient(), []);
  const [tab, setTab] = useState<'design' | 'crud'>('design');

  return (
    <>
      <header className="top">
        <h1>Modeler — マスタメンテナンス開発ツール</h1>
        <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>v0.1</span>
      </header>
      <div className="container">
        <nav className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'design'}
            className={tab === 'design' ? 'active' : ''}
            onClick={() => setTab('design')}
          >
            1. モデル設計
          </button>
          <button
            role="tab"
            aria-selected={tab === 'crud'}
            className={tab === 'crud' ? 'active' : ''}
            onClick={() => setTab('crud')}
          >
            2. デプロイ済みモデル
          </button>
        </nav>

        {tab === 'design' ? <ModelDesignerView api={api} /> : <DeployedModelsView api={api} />}
      </div>
    </>
  );
}
