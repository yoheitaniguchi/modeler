import type { ModelDefinition, Record as ModelRecord } from './model.js';
import { validateRecord } from './validation.js';

/** サポートするインポートフォーマット */
export type ImportFormat = 'csv' | 'tsv' | 'json';

/**
 * 1 行分のバリデーションエラー。
 * row は 1 始まりの「データ行番号」(ヘッダ行を除く)。
 */
export interface RowError {
  /** データ行番号 (1 始まり、ヘッダ除く) */
  row: number;
  /** エラーが発生したフィールド名 */
  field: string;
  /** エラーメッセージ */
  message: string;
}

/** 一括インポートのパース・バリデーション結果 */
export type BulkImportResult =
  | { ok: true; records: Omit<ModelRecord, 'id'>[] }
  | { ok: false; rowErrors: RowError[]; parseError?: string };

/**
 * テキスト文字列をデリミタで分割する。
 * ダブルクォートで囲まれたフィールドの中のデリミタは無視する (RFC 4180 簡易準拠)。
 */
function splitRow(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // エスケープされたダブルクォート
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (!inQuote && line.startsWith(delimiter, i)) {
      result.push(current.trim());
      current = '';
      i += delimiter.length - 1;
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * CSV / TSV テキストをパースしてオブジェクト配列にする。
 * - 1 行目をヘッダとして扱う。
 * - 空行はスキップ。
 */
function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return [];

  const headers = splitRow(nonEmpty[0], delimiter);
  return nonEmpty.slice(1).map((line) => {
    const cols = splitRow(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });
}

/**
 * 文字列値をフィールド型にキャストする。
 * 変換に失敗した場合は元の文字列を返す (バリデーションで弾く)。
 */
function castValue(raw: string, type: string): unknown {
  if (raw === '' || raw === null || raw === undefined) return '';
  switch (type) {
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case 'boolean':
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      return raw; // 型エラーはバリデーション層で検出
    default:
      return raw;
  }
}

/**
 * ファイル内容をパースし、モデル定義に対してバリデーションを実行する。
 *
 * @param text   ファイルのテキスト内容
 * @param format インポートフォーマット
 * @param model  バリデーション対象のモデル定義
 */
export function parseBulkImport(
  text: string,
  format: ImportFormat,
  model: ModelDefinition,
): BulkImportResult {
  // --- パース ---
  let rawRows: Record<string, unknown>[];

  try {
    if (format === 'json') {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return { ok: false, rowErrors: [], parseError: 'JSON のルートは配列である必要があります' };
      }
      rawRows = parsed as Record<string, unknown>[];
    } else {
      const delimiter = format === 'tsv' ? '\t' : ',';
      const strRows = parseDelimited(text, delimiter);
      // 文字列値を型変換
      rawRows = strRows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const field of model.fields) {
          if (field.name in row) {
            out[field.name] = castValue(row[field.name] as string, field.type);
          }
        }
        return out;
      });
    }
  } catch (e) {
    return {
      ok: false,
      rowErrors: [],
      parseError: `パースエラー: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (rawRows.length === 0) {
    return { ok: false, rowErrors: [], parseError: 'データ行が 0 件です' };
  }

  // --- バリデーション ---
  const rowErrors: RowError[] = [];

  rawRows.forEach((row, idx) => {
    const result = validateRecord(model, row as Record<string, unknown>);
    if (!result.ok) {
      result.errors.forEach((msg) => {
        // "fieldName: エラーメッセージ" の形式を分解
        const colonIdx = msg.indexOf(':');
        const field = colonIdx !== -1 ? msg.slice(0, colonIdx).trim() : '(unknown)';
        const message = colonIdx !== -1 ? msg.slice(colonIdx + 1).trim() : msg;
        rowErrors.push({ row: idx + 1, field, message });
      });
    }
  });

  if (rowErrors.length > 0) {
    return { ok: false, rowErrors };
  }

  return { ok: true, records: rawRows as Omit<ModelRecord, 'id'>[] };
}

/**
 * RowError の配列をログ用テキストに整形する。
 * TSV 形式で「行番号 / フィールド / エラー」を出力する。
 */
export function formatErrorLog(rowErrors: RowError[]): string {
  const header = '行番号\tフィールド\tエラー内容';
  const rows = rowErrors.map((e) => `${e.row}\t${e.field}\t${e.message}`);
  return [header, ...rows].join('\n');
}

/**
 * レコード配列を指定フォーマットにシリアライズする (エクスポート用)。
 */
export function serializeRecords(
  records: ModelRecord[],
  format: ImportFormat,
  model: ModelDefinition,
): string {
  if (format === 'json') {
    return JSON.stringify(records, null, 2);
  }

  const delimiter = format === 'tsv' ? '\t' : ',';
  const headers = model.fields.map((f) => f.name);

  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    // カンマ/改行/ダブルクォートを含む場合はダブルクォートで囲む
    if (s.includes(delimiter) || s.includes('\n') || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headerLine = headers.map(escape).join(delimiter);
  const dataLines = records.map((r) => headers.map((h) => escape(r[h])).join(delimiter));
  return [headerLine, ...dataLines].join('\n');
}
