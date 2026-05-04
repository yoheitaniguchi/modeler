import { useEffect, useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { CrudView } from './CrudView.js';

/**
 * デプロイ済みモデルの一覧 → 選択 → CRUD 画面表示。
 * 「設計」と「実データ操作」の責務を分離するため別 View に切り出す。
 */
export function DeployedModelsView({ api }: { api: ApiClient }) {
  const [models, setModels] = useState<ModelDefinition[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listModels().then(
      (m) => { if (!cancelled) setModels(m); },
      (e) => { if (!cancelled) setError(String(e)); },
    );
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <div className="errors">{error}</div>;
  if (models === null) return <p className="muted">読み込み中…</p>;
  if (models.length === 0) {
    return (
      <p className="muted">
        まだデプロイされたモデルがありません。「モデル設計」タブでモデルを定義し、
        「デプロイ」ボタンを押してください。
      </p>
    );
  }

  const current = models.find((m) => m.name === selected);

  return (
    <section>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <label>モデル <select
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value || null)}
        >
          <option value="">選択してください</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>{m.label} ({m.name})</option>
          ))}
        </select></label>
      </div>

      {current && <CrudView api={api} model={current} />}
    </section>
  );
}
