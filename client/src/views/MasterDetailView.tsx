import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldDefinition, ModelDefinition, Record as ModelRecord } from '@modeler/shared';
import { getDetailModels, getParentField, validateRecord } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { FieldInput } from '../components/FieldInput.js';
import { RecordFormModal } from '../components/RecordFormModal.js';
import { CopyFromExistingModal } from '../components/CopyFromExistingModal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { SearchBar } from '../components/SearchBar.js';
import { BulkImportModal } from '../components/BulkImportModal.js';
import { applyFilters, type FilterMap } from '../services/filter.js';

function getExportFilename(modelName: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${modelName}${yyyy}${mm}${dd}-${hh}${min}${ss}.tsv`;
}

/**
 * マスター・ディテール画面 (ui.layout = 'masterDetail')。
 *
 * 上半分: ヘッダー一覧 + 選択ヘッダーの編集フォーム
 * 下半分: 選択ヘッダーに紐づく明細のインライン編集グリッド
 *
 * 設計:
 *   - 単一の `selectedHeaderId` を画面状態として保持
 *   - 明細はサーバーから取得した状態を `lineDraft` (シャドウ) に持って編集
 *   - 「明細を保存」で削除/更新/作成を逐次サーバーに送る (v1 はバッチAPI無し)
 *   - 子モデルが複数ある場合は最初の 1 つだけを扱う (v1 スコープ)
 */
export function MasterDetailView({
  api,
  headerModel,
  allModels,
}: {
  api: ApiClient;
  headerModel: ModelDefinition;
  allModels: ModelDefinition[];
}) {
  // ドキュメントを再構築して getDetailModels を呼ぶ
  const detailModels = useMemo(
    () => getDetailModels(headerModel, { version: 1, models: allModels }),
    [headerModel, allModels],
  );
  const detailModel = detailModels[0]; // v1 では最初の子モデルのみ扱う
  const parentField = detailModel ? getParentField(detailModel) : undefined;

  const [headers, setHeaders] = useState<ModelRecord[]>([]);
  const [lines, setLines] = useState<ModelRecord[]>([]);
  const [loadingHeaders, setLoadingHeaders] = useState(true);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [selectedHeaderId, setSelectedHeaderId] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState<ModelRecord[]>([]);
  const [tempSeq, setTempSeq] = useState(1);

  const [headerModalOpen, setHeaderModalOpen] = useState(false);
  const [headerModalRecord, setHeaderModalRecord] = useState<ModelRecord | null>(null);
  const [headerModalIsEdit, setHeaderModalIsEdit] = useState(false);
  const [headerModalSaving, setHeaderModalSaving] = useState(false);
  const [headerModalErrors, setHeaderModalErrors] = useState<string[]>([]);

  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteHeaderConfirm, setDeleteHeaderConfirm] = useState<string | null>(null);

  // 検索 (ヘッダー / 明細) — 各々独立にスコープを持つ
  const [headerKeyword, setHeaderKeyword] = useState('');
  const [headerFilters, setHeaderFilters] = useState<FilterMap>({});
  const [detailKeyword, setDetailKeyword] = useState('');
  const [detailFilters, setDetailFilters] = useState<FilterMap>({});

  // インポートモーダル (ヘッダー / 明細 別々)
  const [headerImportOpen, setHeaderImportOpen] = useState(false);
  const [detailImportOpen, setDetailImportOpen] = useState(false);

  const reloadHeaders = useCallback(async () => {
    setLoadingHeaders(true);
    try {
      const recs = await api.list(headerModel.name);
      setHeaders(recs);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingHeaders(false);
    }
  }, [api, headerModel.name]);

  const reloadLines = useCallback(
    async (headerId: string | null) => {
      if (!detailModel || !parentField || !headerId) {
        setLines([]);
        setLineDraft([]);
        return;
      }
      setLoadingLines(true);
      try {
        const all = await api.list(detailModel.name);
        const mine = all.filter((r) => String(r[parentField.name] ?? '') === headerId);
        setLines(mine);
        setLineDraft(mine.map((r) => ({ ...r })));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoadingLines(false);
      }
    },
    [api, detailModel, parentField],
  );

  useEffect(() => {
    void reloadHeaders();
  }, [reloadHeaders]);

  useEffect(() => {
    void reloadLines(selectedHeaderId);
  }, [reloadLines, selectedHeaderId]);

  const filteredHeaders = useMemo(
    () => applyFilters(headers, headerModel.fields, headerKeyword, headerFilters),
    [headers, headerModel.fields, headerKeyword, headerFilters],
  );
  const filteredLineDraft = useMemo(
    () => {
      if (!detailModel) return lineDraft;
      // 一時IDは検索フィルタ対象外 (新規追加行は常に表示)
      const matched = applyFilters(lineDraft, detailModel.fields, detailKeyword, detailFilters);
      const tempLines = lineDraft.filter((l) => isTempId(l.id) && !matched.includes(l));
      return [...matched, ...tempLines];
    },
    [lineDraft, detailModel, detailKeyword, detailFilters],
  );

  const selectHeader = (id: string) => setSelectedHeaderId(id);

  // ===== ヘッダー操作 =====
  const openHeaderCreate = () => {
    const initial: ModelRecord = { id: '' };
    headerModel.fields.forEach((f) => { if (f.defaultValue !== undefined) initial[f.name] = f.defaultValue; });
    setHeaderModalRecord(initial);
    setHeaderModalIsEdit(false);
    setHeaderModalErrors([]);
    setHeaderModalOpen(true);
  };
  const openHeaderEdit = (rec: ModelRecord) => {
    setHeaderModalRecord({ ...rec });
    setHeaderModalIsEdit(true);
    setHeaderModalErrors([]);
    setHeaderModalOpen(true);
  };
  const saveHeader = async (body: Record<string, unknown>) => {
    setHeaderModalSaving(true);
    setHeaderModalErrors([]);
    try {
      if (headerModalIsEdit && headerModalRecord?.id) {
        await api.update(headerModel.name, String(headerModalRecord.id), body);
      } else {
        const created = await api.create(headerModel.name, body);
        setSelectedHeaderId(String(created.id));
      }
      await reloadHeaders();
      setHeaderModalOpen(false);
    } catch (e) {
      setHeaderModalErrors(e instanceof ApiError ? e.toMessages() : [String(e)]);
    } finally {
      setHeaderModalSaving(false);
    }
  };
  const deleteHeader = async (id: string) => {
    try {
      await api.remove(headerModel.name, id);
      if (selectedHeaderId === id) setSelectedHeaderId(null);
      setDeleteHeaderConfirm(null);
      await reloadHeaders();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.toMessages() : [String(e)]);
      setDeleteHeaderConfirm(null);
    }
  };

  // ===== 明細操作 =====
  const newTempId = () => {
    const id = `tmp-${tempSeq}`;
    setTempSeq((n) => n + 1);
    return id;
  };
  const addEmptyLine = () => {
    if (!selectedHeaderId || !detailModel || !parentField) return;
    const initial: ModelRecord = { id: newTempId() };
    detailModel.fields.forEach((f) => {
      if (f.name === parentField.name) initial[f.name] = selectedHeaderId;
      else if (f.defaultValue !== undefined) initial[f.name] = f.defaultValue;
    });
    setLineDraft((cur) => [...cur, initial]);
  };
  const updateLineField = (idx: number, fname: string, value: unknown) => {
    setLineDraft((cur) => cur.map((l, i) => (i === idx ? { ...l, [fname]: value } : l)));
  };
  const removeLine = (idx: number) => {
    setLineDraft((cur) => cur.filter((_, i) => i !== idx));
  };
  const saveLines = async () => {
    if (!detailModel || !parentField || !selectedHeaderId) return;
    setActionError([]);
    setActionNotice(null);
    const errors: string[] = [];
    const collect = (rowLabel: string, e: unknown) => {
      const msgs = e instanceof ApiError ? e.toMessages() : [String(e)];
      msgs.forEach((m) => errors.push(`${rowLabel}: ${m}`));
    };

    // 事前バリデーション: 行ごとに validateRecord で必須欠落等を検出し、
    // ある行が NG ならその行はサーバーに送らない (= 400 連発を避ける)
    const validDraft: typeof lineDraft = [];
    for (let i = 0; i < lineDraft.length; i++) {
      const l = lineDraft[i];
      const body = { ...l, [parentField.name]: selectedHeaderId } as Record<string, unknown>;
      const vr = validateRecord(detailModel, body);
      if (!vr.ok) {
        vr.errors.forEach((m) => errors.push(`${i + 1} 行目: ${m}`));
      } else {
        validDraft.push(l);
      }
    }
    if (errors.length > 0) {
      // バリデーションエラーがあれば送信せずに止める (途中保存で不整合になるのを防ぐ)
      setActionError(errors);
      return;
    }

    // 1. 削除 (元にあって draft にない)
    const draftIds = new Set(lineDraft.map((l) => String(l.id)));
    for (const orig of lines) {
      const oid = String(orig.id);
      if (!draftIds.has(oid)) {
        try {
          await api.remove(detailModel.name, oid);
        } catch (e) {
          collect(`削除(${oid})`, e);
        }
      }
    }

    // 2. 更新 (既存IDのみ。サーバーで消えていた場合は 404 = 既に消えているので無視)
    const origIds = new Set(lines.map((l) => String(l.id)));
    let createdCount = 0;
    let updatedCount = 0;
    for (let i = 0; i < lineDraft.length; i++) {
      const l = lineDraft[i];
      const { id, _deleted: __deleted, ...rest } = l;
      const body = { ...rest, [parentField.name]: selectedHeaderId };
      try {
        if (isTempId(id)) {
          await api.create(detailModel.name, body);
          createdCount += 1;
        } else if (origIds.has(String(id))) {
          await api.update(detailModel.name, String(id), body);
          updatedCount += 1;
        } else {
          // draft にはあるが lines (サーバーから取った既存) に無い = 不整合 → 新規作成にフォールバック
          await api.create(detailModel.name, body);
          createdCount += 1;
        }
      } catch (e) {
        const rowLabel = `${i + 1} 行目`;
        collect(rowLabel, e);
      }
    }

    // 結果反映
    await reloadLines(selectedHeaderId);
    await reloadHeaders();
    if (errors.length > 0) {
      setActionError(errors);
      setActionNotice(null);
    } else {
      setActionNotice(`明細を保存しました (作成 ${createdCount} 件 / 更新 ${updatedCount} 件)`);
    }
  };
  const handleCopiedFromExisting = (records: Array<Record<string, unknown>>) => {
    setLineDraft((cur) => [
      ...cur,
      ...records.map((r) => ({ ...r, id: newTempId() } as ModelRecord)),
    ]);
    setActionNotice(`${records.length} 行をコピーしました (未保存)`);
  };

  // ===== レンダリング =====
  if (!detailModel || !parentField) {
    return (
      <section className="master-detail-empty" data-testid="master-detail-empty">
        <p className="muted">
          このモデルは masterDetail レイアウトに設定されていますが、明細(子)モデルが定義されていません。
          子モデルを追加して <code>parent.model</code> にこのモデル名を指定してください。
        </p>
      </section>
    );
  }

  const headerColumns = headerModel.fields.filter((f) => f.showInList !== false);
  const lineColumns = detailModel.fields.filter(
    (f) => f.name !== 'id' && f.name !== parentField.name && f.showInList !== false,
  );

  return (
    <section className="master-detail" data-testid="master-detail-view">
      {error && <div className="errors">{error}</div>}
      {actionError.length > 0 && <div className="errors">{actionError.map((m) => <div key={m}>{m}</div>)}</div>}
      {actionNotice && <div className="notice" role="status">{actionNotice}</div>}

      {/* ===== 上半分: ヘッダー ===== */}
      <div className="md-pane md-master" data-testid="md-master-pane">
        <div className="md-pane-header">
          <h3 style={{ margin: 0 }}>
            {headerModel.ui?.listTitle ?? headerModel.label} <span className="muted">({headerModel.name})</span>
          </h3>
          <div className="row" style={{ gap: '0.4rem' }}>
            <button className="primary" data-testid="md-header-create" onClick={openHeaderCreate}>
              + {headerModel.ui?.createButtonLabel ?? '新規ヘッダー'}
            </button>
            <button
              className="ghost"
              onClick={() => setHeaderImportOpen(true)}
              data-testid="md-header-import"
            >
              インポート
            </button>
            <a
              href={api.exportUrl(headerModel.name, 'tsv')}
              download={getExportFilename(headerModel.name)}
              className="button ghost"
              data-testid="md-header-export"
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white', textDecoration: 'none', display: 'inline-block', cursor: 'pointer' }}
            >
              エクスポート
            </a>
          </div>
        </div>
        <SearchBar
          fields={headerModel.fields.filter((f) => f.showInList !== false)}
          keyword={headerKeyword}
          filters={headerFilters}
          onKeywordChange={setHeaderKeyword}
          onFiltersChange={setHeaderFilters}
          hits={filteredHeaders.length}
          total={headers.length}
        />
        {loadingHeaders ? (
          <p className="muted">読み込み中...</p>
        ) : (
          <table className="md-table" data-testid="md-header-table">
            <thead>
              <tr>
                <th style={{ width: '2rem' }}></th>
                {headerColumns.map((f) => (
                  <th key={f.name}>{f.label || f.name}</th>
                ))}
                <th style={{ width: '6rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredHeaders.length === 0 ? (
                <tr><td colSpan={headerColumns.length + 2} className="muted">
                  {headers.length === 0 ? 'ヘッダーレコードがありません。' : '該当するヘッダーがありません。'}
                </td></tr>
              ) : filteredHeaders.map((h) => {
                const id = String(h.id);
                const isSelected = id === selectedHeaderId;
                return (
                  <tr
                    key={id}
                    data-testid={`md-header-row-${id}`}
                    className={isSelected ? 'is-selected' : ''}
                    onClick={() => selectHeader(id)}
                    style={{ cursor: 'pointer', background: isSelected ? '#eff6ff' : undefined }}
                  >
                    <td>{isSelected ? '●' : ''}</td>
                    {headerColumns.map((f) => (
                      <td key={f.name}>{formatCell(h[f.name])}</td>
                    ))}
                    <td>
                      <button
                        className="ghost"
                        data-testid={`md-header-edit-${id}`}
                        onClick={(e) => { e.stopPropagation(); openHeaderEdit(h); }}
                      >
                        編集
                      </button>
                      <button
                        className="danger"
                        data-testid={`md-header-delete-${id}`}
                        onClick={(e) => { e.stopPropagation(); setDeleteHeaderConfirm(id); }}
                        style={{ marginLeft: '0.3rem' }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== 下半分: 明細 ===== */}
      <div className="md-pane md-detail" data-testid="md-detail-pane">
        <div className="md-pane-header">
          <h3 style={{ margin: 0 }}>
            {detailModel.ui?.listTitle ?? detailModel.label} <span className="muted">({detailModel.name})</span>
          </h3>
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <button
              className="ghost"
              data-testid="md-line-add"
              onClick={addEmptyLine}
              disabled={!selectedHeaderId}
            >
              + 行追加
            </button>
            <button
              className="ghost"
              data-testid="md-line-copy-from"
              onClick={() => setCopyOpen(true)}
              disabled={!selectedHeaderId}
            >
              既存から…
            </button>
            <button
              className="ghost"
              data-testid="md-line-import"
              onClick={() => setDetailImportOpen(true)}
            >
              インポート
            </button>
            <a
              href={api.exportUrl(detailModel.name, 'tsv')}
              download={getExportFilename(detailModel.name)}
              className="button ghost"
              data-testid="md-line-export"
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white', textDecoration: 'none', display: 'inline-block', cursor: 'pointer' }}
            >
              エクスポート
            </a>
            <button
              className="primary"
              data-testid="md-line-save"
              onClick={saveLines}
              disabled={!selectedHeaderId}
            >
              明細を保存
            </button>
          </div>
        </div>

        {selectedHeaderId && (
          <SearchBar
            fields={detailModel.fields.filter((f) => f.showInList !== false && f.name !== parentField.name)}
            keyword={detailKeyword}
            filters={detailFilters}
            onKeywordChange={setDetailKeyword}
            onFiltersChange={setDetailFilters}
            hits={filteredLineDraft.length}
            total={lineDraft.length}
          />
        )}

        {!selectedHeaderId ? (
          <p className="muted" data-testid="md-detail-empty">← 上のヘッダー一覧からヘッダーを選択してください</p>
        ) : loadingLines ? (
          <p className="muted">読み込み中...</p>
        ) : (
          <table className="md-table md-editable" data-testid="md-line-table">
            <thead>
              <tr>
                <th style={{ width: '3rem' }}>行</th>
                {lineColumns.map((f) => (
                  <th key={f.name}>{f.label || f.name}{f.required && <span className="required-mark"> *</span>}</th>
                ))}
                <th style={{ width: '5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredLineDraft.length === 0 ? (
                <tr>
                  <td colSpan={lineColumns.length + 2} className="muted">
                    {lineDraft.length === 0
                      ? '明細がありません。「+ 行追加」または「既存から…」で行を追加してください。'
                      : '該当する明細がありません。'}
                  </td>
                </tr>
              ) : filteredLineDraft.map((l) => {
                // 編集操作は元の lineDraft 内の位置で行う必要がある
                const origIdx = lineDraft.findIndex((x) => x.id === l.id);
                return (
                  <tr key={String(l.id)} data-testid={`md-line-row-${l.id}`}>
                    <td>{origIdx + 1}</td>
                    {lineColumns.map((f) => (
                      <td key={f.name}>
                        <FieldInput
                          field={f}
                          value={l[f.name]}
                          onChange={(v) => updateLineField(origIdx, f.name, v)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="danger"
                        data-testid={`md-line-delete-${l.id}`}
                        onClick={() => removeLine(origIdx)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ヘッダー作成・編集モーダル */}
      {headerModalOpen && (
        <RecordFormModal
          open={headerModalOpen}
          model={headerModel}
          initialRecord={headerModalRecord}
          isEdit={headerModalIsEdit}
          saving={headerModalSaving}
          errors={headerModalErrors}
          onSave={(form) => saveHeader(form)}
          onCancel={() => setHeaderModalOpen(false)}
        />
      )}

      {/* 既存からコピーモーダル */}
      <CopyFromExistingModal
        open={copyOpen}
        api={api}
        detailModel={detailModel}
        parentField={parentField}
        newParentId={selectedHeaderId ?? ''}
        onConfirm={handleCopiedFromExisting}
        onClose={() => setCopyOpen(false)}
      />

      {/* ヘッダー削除確認 */}
      <ConfirmDialog
        open={deleteHeaderConfirm !== null}
        message={`ヘッダー「${deleteHeaderConfirm}」を削除します。\n紐づく明細は onDelete 設定に従って処理されます。`}
        okLabel="削除"
        onOk={() => deleteHeaderConfirm && deleteHeader(deleteHeaderConfirm)}
        onCancel={() => setDeleteHeaderConfirm(null)}
      />

      {/* ヘッダー一括インポート */}
      <BulkImportModal
        open={headerImportOpen}
        model={headerModel}
        api={api}
        onImported={async () => { await reloadHeaders(); }}
        onClose={() => setHeaderImportOpen(false)}
      />

      {/* 明細一括インポート (全件単位 — 親IDは TSV/CSV/JSON 上で指定する想定) */}
      <BulkImportModal
        open={detailImportOpen}
        model={detailModel}
        api={api}
        onImported={async () => { await reloadLines(selectedHeaderId); await reloadHeaders(); }}
        onClose={() => setDetailImportOpen(false)}
      />
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '✓' : '';
  return String(v);
}

function isTempId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('tmp-');
}
