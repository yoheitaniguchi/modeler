import messagesData from './messages.json' with { type: 'json' };

export type MessageType = 'http' | 'import' | 'validation';

export interface MessageEntry {
  code: string;
  type: MessageType;
  message: string;
}

const messageMap = new Map<string, string>(
  (messagesData.messages as MessageEntry[]).map((m) => [m.code, m.message]),
);

/** メッセージコードからメッセージ文字列を取得する。{{key}} 形式のプレースホルダーを置換する。 */
export function getMessage(code: string, params?: Record<string, string | number>): string {
  const template = messageMap.get(code) ?? code;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''));
}

export const MSG = {
  // HTTP レスポンスメッセージ
  HTTP_NOT_FOUND: 'HTTP_NOT_FOUND',
  HTTP_INTERNAL_ERROR: 'HTTP_INTERNAL_ERROR',
  HTTP_MODEL_NOT_FOUND: 'HTTP_MODEL_NOT_FOUND',
  HTTP_IMPORT_FILE_REQUIRED: 'HTTP_IMPORT_FILE_REQUIRED',
  HTTP_INVALID_FORMAT: 'HTTP_INVALID_FORMAT',
  // 一括インポートメッセージ
  IMPORT_JSON_ROOT_MUST_BE_ARRAY: 'IMPORT_JSON_ROOT_MUST_BE_ARRAY',
  IMPORT_PARSE_ERROR: 'IMPORT_PARSE_ERROR',
  IMPORT_NO_DATA_ROWS: 'IMPORT_NO_DATA_ROWS',
  // レコードバリデーションメッセージ
  RECORD_REQUIRED: 'RECORD_REQUIRED',
  RECORD_MUST_BE_STRING: 'RECORD_MUST_BE_STRING',
  RECORD_MIN_LENGTH: 'RECORD_MIN_LENGTH',
  RECORD_MAX_LENGTH: 'RECORD_MAX_LENGTH',
  RECORD_MUST_MATCH_PATTERN: 'RECORD_MUST_MATCH_PATTERN',
  RECORD_MUST_BE_NUMBER: 'RECORD_MUST_BE_NUMBER',
  RECORD_MIN_VALUE: 'RECORD_MIN_VALUE',
  RECORD_MAX_VALUE: 'RECORD_MAX_VALUE',
  RECORD_MUST_BE_BOOLEAN: 'RECORD_MUST_BE_BOOLEAN',
  RECORD_MUST_BE_ISO_DATE: 'RECORD_MUST_BE_ISO_DATE',
  RECORD_MUST_BE_UNIQUE: 'RECORD_MUST_BE_UNIQUE',
  RECORD_PK_REQUIRED: 'RECORD_PK_REQUIRED',
  RECORD_PK_MUST_BE_UNIQUE: 'RECORD_PK_MUST_BE_UNIQUE',
  RECORD_COMPOSITE_PK_UNIQUE: 'RECORD_COMPOSITE_PK_UNIQUE',
  RECORD_FK_TARGET_NOT_DEPLOYED: 'RECORD_FK_TARGET_NOT_DEPLOYED',
  RECORD_FK_NOT_FOUND: 'RECORD_FK_NOT_FOUND',
  RECORD_REFERENCED: 'RECORD_REFERENCED',
} as const;

export type MessageCode = keyof typeof MSG;
