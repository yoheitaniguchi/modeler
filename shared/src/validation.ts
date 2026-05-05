import type {
  ButtonDefinition,
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ModelDefinitionDocument,
} from './model.js';

/**
 * バリデーション関数群。
 *
 * 設計方針:
 *   - 「壊れたデータを早く落とす」のがバリデーションの仕事。受け取った
 *     非信頼データ (JSON ファイル / HTTP ボディ) を一度ここに通してから
 *     業務ロジックに渡すと、後段が必ず正しい型のデータを扱える。
 *   - 例外を投げる代わりに ValidationResult を返す。理由は「どこが何件
 *     ダメだったか」をまとめて UI に出したいから。例外だと最初の 1 件で
 *     止まり、ユーザー体験が悪くなる。
 */

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const FIELD_TYPES: readonly FieldType[] = ['string', 'number', 'boolean', 'date'];

/** 識別子は英字始まり + 英数アンダースコア。SQL 予約語っぽい衝突を避ける素朴なルール。 */
const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function validateFieldDefinition(field: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof field !== 'object' || field === null) {
    return [`${path}: must be an object`];
  }
  const f = field as Partial<FieldDefinition>;

  if (typeof f.name !== 'string' || !IDENTIFIER_PATTERN.test(f.name)) {
    errors.push(`${path}.name: must match ${IDENTIFIER_PATTERN}`);
  }
  if (typeof f.label !== 'string' || f.label.trim() === '') {
    errors.push(`${path}.label: must be non-empty string`);
  }
  if (typeof f.type !== 'string' || !FIELD_TYPES.includes(f.type as FieldType)) {
    errors.push(`${path}.type: must be one of ${FIELD_TYPES.join(', ')}`);
  }
  if (typeof f.required !== 'boolean') {
    errors.push(`${path}.required: must be boolean`);
  }

  // デフォルト値が指定されていれば、型チェック。undefined/null は常に OK。
  if (f.defaultValue !== undefined && f.defaultValue !== null) {
    const err = validateDefaultValue(f.type as FieldType, f.defaultValue);
    if (err) errors.push(`${path}.defaultValue: ${err}`);
  }

  // optionsUrl が指定されていれば、type==='string' のみ許可
  if (f.optionsUrl !== undefined) {
    if (typeof f.optionsUrl !== 'string' || f.optionsUrl.trim() === '') {
      errors.push(`${path}.optionsUrl: must be non-empty string when provided`);
    } else if (f.type !== 'string') {
      errors.push(`${path}.optionsUrl: only valid when type is "string"`);
    }
  }

  return errors;
}

function validateDefaultValue(type: FieldType, value: unknown): string | null {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : 'must be string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value) ? null : 'must be number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'must be ISO date string';
  }
}

export function validateModelDefinition(model: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof model !== 'object' || model === null) {
    return [`${path}: must be an object`];
  }
  const m = model as Partial<ModelDefinition>;

  if (typeof m.name !== 'string' || !IDENTIFIER_PATTERN.test(m.name)) {
    errors.push(`${path}.name: must match ${IDENTIFIER_PATTERN}`);
  }
  if (typeof m.label !== 'string' || m.label.trim() === '') {
    errors.push(`${path}.label: must be non-empty string`);
  }
  if (!Array.isArray(m.fields)) {
    errors.push(`${path}.fields: must be array`);
    return errors;
  }
  if (m.fields.length === 0) {
    errors.push(`${path}.fields: must contain at least one field`);
  }

  // フィールド名の重複は DAO 層でカラム衝突を起こすので早めに弾く
  const seen = new Set<string>();
  m.fields.forEach((field, idx) => {
    errors.push(...validateFieldDefinition(field, `${path}.fields[${idx}]`));
    const name = (field as Partial<FieldDefinition>).name;
    if (typeof name === 'string') {
      if (seen.has(name)) {
        errors.push(`${path}.fields[${idx}].name: duplicated "${name}"`);
      }
      seen.add(name);
    }
  });

  // UI 設定 (ボタン定義) のバリデーション。未設定なら何もしない。
  if (m.ui !== undefined) {
    errors.push(...validateUiConfig(m.ui, `${path}.ui`));
  }
  return errors;
}

const HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const BUTTON_SCOPES: readonly string[] = ['row', 'screen'];
const BUTTON_STYLES: readonly string[] = ['primary', 'danger', 'ghost'];
const BUILTIN_OPS: readonly string[] = ['create', 'update', 'edit', 'delete'];
const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function validateButtonDefinition(button: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof button !== 'object' || button === null) {
    return [`${path}: must be an object`];
  }
  const b = button as Partial<ButtonDefinition>;
  if (typeof b.id !== 'string' || !ID_PATTERN.test(b.id)) {
    errors.push(`${path}.id: must match ${ID_PATTERN}`);
  }
  if (typeof b.label !== 'string' || b.label.trim() === '') {
    errors.push(`${path}.label: must be non-empty string`);
  }
  if (typeof b.scope !== 'string' || !BUTTON_SCOPES.includes(b.scope)) {
    errors.push(`${path}.scope: must be one of ${BUTTON_SCOPES.join(', ')}`);
  }
  if (b.style !== undefined && !BUTTON_STYLES.includes(b.style as string)) {
    errors.push(`${path}.style: must be one of ${BUTTON_STYLES.join(', ')}`);
  }
  // action
  if (typeof b.action !== 'object' || b.action === null) {
    errors.push(`${path}.action: must be an object`);
  } else {
    const a = b.action as { kind?: string };
    if (a.kind === 'builtin') {
      const op = (b.action as { op?: string }).op;
      if (typeof op !== 'string' || !BUILTIN_OPS.includes(op)) {
        errors.push(`${path}.action.op: must be one of ${BUILTIN_OPS.join(', ')}`);
      }
    } else if (a.kind === 'http') {
      const http = b.action as {
        method?: string;
        url?: string;
        bodyTemplate?: unknown;
        confirmMessage?: unknown;
        openResponseInNewTab?: unknown;
      };
      if (typeof http.method !== 'string' || !HTTP_METHODS.includes(http.method)) {
        errors.push(`${path}.action.method: must be one of ${HTTP_METHODS.join(', ')}`);
      }
      if (typeof http.url !== 'string' || http.url.trim() === '') {
        errors.push(`${path}.action.url: must be non-empty string`);
      }
      if (http.bodyTemplate !== undefined && typeof http.bodyTemplate !== 'string') {
        errors.push(`${path}.action.bodyTemplate: must be string when provided`);
      }
      if (http.confirmMessage !== undefined && typeof http.confirmMessage !== 'string') {
        errors.push(`${path}.action.confirmMessage: must be string when provided`);
      }
      if (
        http.openResponseInNewTab !== undefined &&
        typeof http.openResponseInNewTab !== 'boolean'
      ) {
        errors.push(`${path}.action.openResponseInNewTab: must be boolean when provided`);
      }
    } else {
      errors.push(`${path}.action.kind: must be 'builtin' or 'http'`);
    }
  }
  return errors;
}

function validateBuiltinOverride(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return [`${path}: must be an object`];
  }
  const v = value as { url?: unknown; method?: unknown };
  if (typeof v.url !== 'string' || v.url.trim() === '') {
    errors.push(`${path}.url: must be non-empty string`);
  }
  if (typeof v.method !== 'string' || !HTTP_METHODS.includes(v.method)) {
    errors.push(`${path}.method: must be one of ${HTTP_METHODS.join(', ')}`);
  }
  return errors;
}

function validateUiConfig(ui: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof ui !== 'object' || ui === null) {
    return [`${path}: must be an object`];
  }
  const u = ui as { buttons?: unknown; builtinButtonOverrides?: unknown };
  if (u.buttons !== undefined) {
    if (!Array.isArray(u.buttons)) {
      errors.push(`${path}.buttons: must be array`);
    } else {
      const seenIds = new Set<string>();
      u.buttons.forEach((b, idx) => {
        errors.push(...validateButtonDefinition(b, `${path}.buttons[${idx}]`));
        const id = (b as { id?: unknown }).id;
        if (typeof id === 'string') {
          if (seenIds.has(id)) {
            errors.push(`${path}.buttons[${idx}].id: duplicated "${id}"`);
          }
          seenIds.add(id);
        }
      });
    }
  }
  if (u.builtinButtonOverrides !== undefined) {
    if (typeof u.builtinButtonOverrides !== 'object' || u.builtinButtonOverrides === null) {
      errors.push(`${path}.builtinButtonOverrides: must be object`);
    } else {
      const ov = u.builtinButtonOverrides as Record<string, unknown>;
      for (const key of ['create', 'update', 'delete'] as const) {
        if (ov[key] !== undefined) {
          errors.push(...validateBuiltinOverride(ov[key], `${path}.builtinButtonOverrides.${key}`));
        }
      }
    }
  }
  return errors;
}

export function validateDocument(doc: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof doc !== 'object' || doc === null) {
    return { ok: false, errors: ['document: must be an object'] };
  }
  const d = doc as Partial<ModelDefinitionDocument>;
  if (d.version !== 1) {
    errors.push('document.version: must be 1');
  }
  if (!Array.isArray(d.models)) {
    errors.push('document.models: must be array');
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  d.models.forEach((model, idx) => {
    errors.push(...validateModelDefinition(model, `document.models[${idx}]`));
    const name = (model as Partial<ModelDefinition>).name;
    if (typeof name === 'string') {
      if (seen.has(name)) {
        errors.push(`document.models[${idx}].name: duplicated "${name}"`);
      }
      seen.add(name);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * レコード (CRUD 対象の値) がモデル定義に従っているかチェックする。
 * required=true のフィールドは undefined / null / 空文字を許さない。
 */
export function validateRecord(
  model: ModelDefinition,
  record: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  for (const field of model.fields) {
    const value = record[field.name];
    const isEmpty = value === undefined || value === null || value === '';
    if (field.required && isEmpty) {
      errors.push(`${field.name}: is required (NOT NULL)`);
      continue;
    }
    if (isEmpty) continue; // optional な空値は OK

    switch (field.type) {
      case 'string':
        if (typeof value !== 'string') errors.push(`${field.name}: must be string`);
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${field.name}: must be number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`${field.name}: must be boolean`);
        break;
      case 'date':
        // JSON で日付を運ぶ際は ISO 文字列が一番互換性が高い。
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          errors.push(`${field.name}: must be ISO date string`);
        }
        break;
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
