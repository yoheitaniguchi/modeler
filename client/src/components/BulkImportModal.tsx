import { useRef, useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import { parseBulkImport } from '@modeler/shared';
import type { BulkImportResult } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';

type Format = 'csv' | 'tsv' | 'json';

/**
 * 一括インポートモーダル。
 *
 * 設計方針:
 *   - ファイル選択時: クライアントサイドで parseBulkImport を実行してバリデーションのみ行う。
 *     サーバーへの送信はしない (= 二重インポートを防ぐ)。
 *   - 「登録」ボタン押下時: サーバーへファイルを POST して実際に登録する。
 *
 * 機能:
 *   - フォーマット (CSV / TSV / JSON) 選択
 *   - ファイル選択 → クライアント側バリデーション
 *   - エラー行の一覧表示 + TSV ログのダウンロード
 *   - 全行 OK の場合のみ「登録」ボタンが有効化される
 */
export function BulkImportModal({
  open,
  model,
  api,
  onImported,
  onClose,
}: {
  open: boolean;
  model: ModelDefinition;
  api: ApiClient;
  onImported: () => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>('csv');
  const [file, setFile] = useState<File | null>(null);
  /** クライアントサイドのバリデーション結果 */
  const [validation, setValidation] = useState<BulkImportResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  /** サーバー登録時のエラー (バリデーション済みなので通常は発生しない) */
  const [serverError, setServerError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setValidation(null);
    setServerError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFormatChange = (f: Format) => {
    setFormat(f);
    reset();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setValidation(null);
    setServerError(null);
    if (!selected) return;

    setValidating(true);
    try {
      // クライアントサイドのみでバリデーション (サーバー送信なし)
      const text = await selected.text();
      const result = parseBulkImport(text, format, model);
      setValidation(result);
    } finally {
      setValidating(false);
    }
  };

  /** 「登録」ボタン: 検証済みファイルをサーバーへ POST (1回のみ) */
  const handleImport = async () => {
    if (!file || !validation?.ok) return;
    setImporting(true);
    setServerError(null);
    try {
      const res = await api.bulkImport(model.name, file, format);
      if (res.rowErrors && res.rowErrors.length > 0) {
        // サーバー側で弾かれた場合 (通常は起きないが念のため)
        setServerError(`サーバーエラー: ${res.rowErrors.map((e) => `行${e.row} ${e.field}: ${e.message}`).join(', ')}`);
        return;
      }
      onImported();
      handleClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const downloadErrorLog = () => {
    if (!validation || validation.ok) return;
    const header = '行番号\tフィールド\tエラー内容';
    const rows = validation.rowErrors.map((e) => `${e.row}\t${e.field}\t${e.message}`);
    const log = [header, ...rows].join('\n');
    const blob = new Blob([log], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.name}_import_errors.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasErrors = validation !== null && !validation.ok;
  const recordCount = validation?.ok ? validation.records.length : 0;
  const canImport = validation?.ok === true && recordCount > 0 && !importing;

  const acceptMap: Record<Format, string> = {
    csv: '.csv',
    tsv: '.tsv,.txt',
    json: '.json',
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" data-testid="bulk-import-modal">
      <div className="modal bulk-import-modal">
        {/* ヘッダ */}
        <div className="bulk-import-header">
          <h3 style={{ margin: 0 }}>一括登録 — {model.label}</h3>
          <button
            className="ghost bulk-import-close"
            onClick={handleClose}
            aria-label="閉じる"
            data-testid="bulk-import-close"
          >
            ✕
          </button>
        </div>

        {/* フォーマット選択 */}
        <div className="bulk-import-section">
          <label className="bulk-import-label">ファイルフォーマット</label>
          <div className="bulk-import-format-group">
            {(['csv', 'tsv', 'json'] as Format[]).map((f) => (
              <label key={f} className="bulk-import-format-option">
                <input
                  type="radio"
                  name="bulk-format"
                  value={f}
                  checked={format === f}
                  onChange={() => handleFormatChange(f)}
                  data-testid={`format-${f}`}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        {/* ファイル選択 */}
        <div className="bulk-import-section">
          <label className="bulk-import-label" htmlFor="bulk-file-input">
            ファイルを選択
          </label>
          <input
            id="bulk-file-input"
            ref={fileInputRef}
            type="file"
            accept={acceptMap[format]}
            onChange={handleFileChange}
            disabled={validating || importing}
            data-testid="bulk-file-input"
            className="bulk-import-file-input"
          />
          {file && (
            <span className="bulk-import-filename muted">
              選択中: {file.name} ({Math.ceil(file.size / 1024)} KB)
            </span>
          )}
        </div>

        {/* バリデーション中 */}
        {validating && (
          <div className="bulk-import-validating muted" data-testid="bulk-validating">
            ⏳ バリデーション中...
          </div>
        )}

        {/* 成功メッセージ */}
        {validation?.ok && (
          <div className="bulk-import-success" data-testid="bulk-validation-ok">
            ✅ {recordCount} 件のデータが有効です。「登録」ボタンで取り込みを確定してください。
          </div>
        )}

        {/* クライアントサイドバリデーションエラー */}
        {hasErrors && !validation.ok && (
          <div className="bulk-import-errors" data-testid="bulk-validation-errors">
            {validation.parseError && (
              <p className="bulk-import-parse-error" data-testid="bulk-parse-error">
                ⛔ {validation.parseError}
              </p>
            )}
            {validation.rowErrors && validation.rowErrors.length > 0 && (
              <>
                <p className="bulk-import-error-title">
                  ⛔ {validation.rowErrors.length} 件のエラーが見つかりました
                </p>
                <div className="bulk-import-error-table-wrap">
                  <table className="bulk-import-error-table" data-testid="bulk-error-table">
                    <thead>
                      <tr>
                        <th>行番号</th>
                        <th>フィールド</th>
                        <th>エラー内容</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.rowErrors.map((e, i) => (
                        <tr key={i}>
                          <td>{e.row}</td>
                          <td>{e.field}</td>
                          <td>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="ghost bulk-import-dl-log"
                  onClick={downloadErrorLog}
                  data-testid="bulk-download-log"
                >
                  ⬇ エラーログをダウンロード (.tsv)
                </button>
              </>
            )}
          </div>
        )}

        {/* サーバーエラー (念のため) */}
        {serverError && (
          <div className="bulk-import-errors" data-testid="bulk-server-error">
            ⛔ {serverError}
          </div>
        )}

        {/* フッタボタン */}
        <div className="bulk-import-footer">
          <button
            className="primary"
            onClick={handleImport}
            disabled={!canImport}
            data-testid="bulk-import-submit"
          >
            {importing ? '登録中...' : '登録'}
          </button>
          <button
            className="ghost"
            onClick={handleClose}
            disabled={importing}
            data-testid="bulk-import-cancel"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
