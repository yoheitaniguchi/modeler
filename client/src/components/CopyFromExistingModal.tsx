import { useEffect, useMemo, useState } from 'react';
import type { FieldDefinition, ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';

/**
 * 「既存レコードから明細にコピー」モーダル。
 *
 * マスター・ディテール画面で、現在編集中ヘッダーの明細に
 * 過去 (他ヘッダー配下含む) の明細レコードをコピー追加するために使う。
 *
 * 仕様:
 *   - `detailModel` 全件を API から取得し、商品名等の columns で一覧表示
 *   - クライアント側で検索フィルタ (case-insensitive 部分一致, 全表示カラムを横断)
 *   - 複数選択 (チェックボックス) して「コピー」で確定
 *   - 確定時、各レコードを「id を除去」「parentField を newParentId で上書き」
 *     したオブジェクトとして `onConfirm` に渡す
 *
 * 注意: 親IDフィールドは上書きされるので、コピー元の親ヘッダーは元のまま無影響。
 */
export function CopyFromExistingModal({
  open,
  api,
  detailModel,
  parentField,
  newParentId,
  onConfirm,
  onClose,
}: {
  open: boolean;
  api: ApiClient;
  detailModel: ModelDefinition;
  parentField: FieldDefinition;
  newParentId: string;
  onConfirm: (records: Array<Record<string, unknown>>) => void;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<ModelRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 一覧で表示するカラム (id / 親フィールド以外を最大4個まで)
  const displayFields = useMemo(
    () =>
      detailModel.fields
        .filter((f) => f.name !== 'id' && f.name !== parentField.name)
        .slice(0, 4),
    [detailModel, parentField],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQuery('');
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .list(detailModel.name)
      .then((rs) => { if (!cancelled) setRecords(rs); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, api, detailModel.name]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      displayFields.some((f) => String(r[f.name] ?? '').toLowerCase().includes(q)),
    );
  }, [records, query, displayFields]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const picked = records.filter((r) => selected.has(String(r.id)));
    const copies = picked.map((src) => {
      const { id: _id, ...rest } = src;
      return { ...rest, [parentField.name]: newParentId };
    });
    onConfirm(copies);
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      data-testid="copy-from-existing-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 id="copy-modal-title" style={{ margin: 0 }}>既存の明細レコードからコピー</h3>
          <button className="ghost" aria-label="閉じる" onClick={onClose}>×</button>
        </div>
        <p className="muted" style={{ margin: '0.4rem 0' }}>
          コピー後、親 ({parentField.name}) は現在のヘッダーに上書きされます。
        </p>
        <div className="row" style={{ marginBottom: '0.4rem' }}>
          <label style={{ flex: 1 }}>
            検索 <input
              type="text"
              data-testid="copy-search"
              placeholder="入力で絞り込み..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
        </div>

        {loading && <p>読み込み中...</p>}
        {error && <p className="inline-error">読み込みエラー: {error}</p>}
        {!loading && !error && (
          <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.9rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '2rem' }}></th>
                  <th style={{ width: '4rem', textAlign: 'left' }}>由来{parentField.label}</th>
                  {displayFields.map((f) => (
                    <th key={f.name} style={{ textAlign: 'left' }}>{f.label || f.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={2 + displayFields.length} className="muted" style={{ padding: '0.5rem' }}>
                      該当するレコードがありません。
                    </td>
                  </tr>
                ) : filtered.map((r) => {
                  const idStr = String(r.id);
                  return (
                    <tr key={idStr} data-testid={`copy-row-${idStr}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(idStr)}
                          onChange={() => toggle(idStr)}
                          data-testid={`copy-check-${idStr}`}
                        />
                      </td>
                      <td>{String(r[parentField.name] ?? '')}</td>
                      {displayFields.map((f) => (
                        <td key={f.name}>{String(r[f.name] ?? '')}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.8rem', gap: '0.4rem' }}>
          <button className="ghost" onClick={onClose} data-testid="copy-cancel">キャンセル</button>
          <button
            className="primary"
            onClick={handleApply}
            disabled={selected.size === 0}
            data-testid="copy-apply"
          >
            選択 {selected.size} 行をコピー
          </button>
        </div>
      </div>
    </div>
  );
}
