import type {
  ButtonDefinition,
  FieldDefinition,
  FieldType,
  ModelDefinition,
  ModelDefinitionDocument,
  ParentRelation,
  RelationKind,
  ReferentialAction,
  ScreenLayout,
} from './model.js';
import { RELATION_KINDS, REFERENTIAL_ACTIONS, SCREEN_LAYOUTS } from './model.js';

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

const FIELD_TYPES: readonly FieldType[] = ['string', 'number', 'boolean', 'date', 'reference', 'id'];

/** 識別子は英字始まり + 英数アンダースコア。SQL 予約語っぽい衝突を避ける素朴なルール。 */
export const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** 識別子として妥当か。UI 側でリアルタイム検証する際に再利用する。 */
export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_PATTERN.test(name);
}

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
  if (f.primaryKey !== undefined && typeof f.primaryKey !== 'boolean') {
    errors.push(`${path}.primaryKey: must be boolean`);
  }
  if (f.showInList !== undefined && typeof f.showInList !== 'boolean') {
    errors.push(`${path}.showInList: must be boolean`);
  }
  if (f.showInDetail !== undefined && typeof f.showInDetail !== 'boolean') {
    errors.push(`${path}.showInDetail: must be boolean`);
  }
  if (f.numberingUrl !== undefined) {
    if (typeof f.numberingUrl !== 'string' || f.numberingUrl.trim() === '') {
      errors.push(`${path}.numberingUrl: must be non-empty string when provided`);
    } else if (f.type !== 'id') {
      errors.push(`${path}.numberingUrl: only valid when type is "id"`);
    }
  }

  // デフォルト値が指定されていれば、型チェック。undefined/null は常に OK。
  if (f.defaultValue !== undefined && f.defaultValue !== null) {
    const err = validateDefaultValue(f.type as FieldType, f.defaultValue);
    if (err) errors.push(`${path}.defaultValue: ${err}`);
  }

  if (f.defaultOnUpdate !== undefined) {
    if (typeof f.defaultOnUpdate !== 'boolean') {
      errors.push(`${path}.defaultOnUpdate: must be boolean`);
    } else if (f.type !== 'date') {
      errors.push(`${path}.defaultOnUpdate: only valid when type is "date"`);
    }
  }

  // optionsUrl が指定されていれば、type==='string' のみ許可
  if (f.optionsUrl !== undefined) {
    if (typeof f.optionsUrl !== 'string' || f.optionsUrl.trim() === '') {
      errors.push(`${path}.optionsUrl: must be non-empty string when provided`);
    } else if (f.type !== 'string') {
      errors.push(`${path}.optionsUrl: only valid when type is "string"`);
    }
  }

  // reference 型の場合は targetModel が必須
  if (f.type === 'reference') {
    if (typeof f.targetModel !== 'string' || f.targetModel.trim() === '') {
      errors.push(`${path}.targetModel: must be non-empty string when type is "reference"`);
    }
    if (f.targetLabelField !== undefined && (typeof f.targetLabelField !== 'string' || f.targetLabelField.trim() === '')) {
      errors.push(`${path}.targetLabelField: must be non-empty string when provided`);
    }
  }

  // relationKind / onDelete / onUpdate は reference 型でのみ有効。
  // manyToMany は型として将来互換のために受け入れるが、ランタイムでは現状未対応。
  if (f.relationKind !== undefined) {
    if (f.type !== 'reference') {
      errors.push(`${path}.relationKind: only valid when type is "reference"`);
    } else if (!RELATION_KINDS.includes(f.relationKind as RelationKind)) {
      errors.push(`${path}.relationKind: must be one of ${RELATION_KINDS.join(', ')}`);
    } else if (f.relationKind === 'manyToMany') {
      errors.push(`${path}.relationKind: 'manyToMany' is not yet supported`);
    }
  }
  if (f.onDelete !== undefined) {
    if (f.type !== 'reference') {
      errors.push(`${path}.onDelete: only valid when type is "reference"`);
    } else if (!REFERENTIAL_ACTIONS.includes(f.onDelete as ReferentialAction)) {
      errors.push(`${path}.onDelete: must be one of ${REFERENTIAL_ACTIONS.join(', ')}`);
    } else if (f.onDelete === 'setNull' && f.required === true) {
      // setNull は NOT NULL カラムには適用できない (整合性が壊れる)
      errors.push(`${path}.onDelete: 'setNull' cannot be used when required is true`);
    }
  }
  if (f.onUpdate !== undefined) {
    if (f.type !== 'reference') {
      errors.push(`${path}.onUpdate: only valid when type is "reference"`);
    } else if (!REFERENTIAL_ACTIONS.includes(f.onUpdate as ReferentialAction)) {
      errors.push(`${path}.onUpdate: must be one of ${REFERENTIAL_ACTIONS.join(', ')}`);
    }
  }

  if (f.validation) {
    if (typeof f.validation !== 'object') {
      errors.push(`${path}.validation: must be an object`);
    } else {
      if (f.validation.pattern !== undefined && typeof f.validation.pattern !== 'string') {
        errors.push(`${path}.validation.pattern: must be string`);
      }
      if (f.validation.minLength !== undefined && typeof f.validation.minLength !== 'number') {
        errors.push(`${path}.validation.minLength: must be number`);
      }
      if (f.validation.maxLength !== undefined && typeof f.validation.maxLength !== 'number') {
        errors.push(`${path}.validation.maxLength: must be number`);
      }
      if (f.validation.min !== undefined && typeof f.validation.min !== 'number') {
        errors.push(`${path}.validation.min: must be number`);
      }
      if (f.validation.max !== undefined && typeof f.validation.max !== 'number') {
        errors.push(`${path}.validation.max: must be number`);
      }
      if (f.validation.unique !== undefined && typeof f.validation.unique !== 'boolean') {
        errors.push(`${path}.validation.unique: must be boolean`);
      }
    }
  }

  if (f.formatters) {
    if (typeof f.formatters !== 'object') {
      errors.push(`${path}.formatters: must be an object`);
    } else {
      if (f.formatters.trim !== undefined && typeof f.formatters.trim !== 'boolean') {
        errors.push(`${path}.formatters.trim: must be boolean`);
      }
      if (f.formatters.fullWidthToHalfWidth !== undefined && typeof f.formatters.fullWidthToHalfWidth !== 'boolean') {
        errors.push(`${path}.formatters.fullWidthToHalfWidth: must be boolean`);
      }
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
      return typeof value === 'string' && (value === 'today' || !Number.isNaN(Date.parse(value))) ? null : 'must be ISO date string';
    case 'reference':
      return typeof value === 'string' ? null : 'must be string ID';
    case 'id':
      return typeof value === 'string' ? null : 'must be string ID';
    default:
      return 'unknown type';
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

  // 親子関係 (parent) の単一モデル内整合性チェック。クロスモデル整合性は後段で実施。
  if (m.parent !== undefined) {
    errors.push(...validateParentRelation(m.parent, m, `${path}.parent`));
  }
  return errors;
}

/**
 * ModelDefinition.parent (親子関係宣言) の単一モデル内チェック。
 *
 * - parent.model / parent.via が両方文字列で空でないこと
 * - parent.via が自モデル内の field 名であり、その field の type が 'reference' であること
 * - その reference の targetModel が parent.model と一致すること
 *
 * 「親モデル自体が実在するか」「親モデル自身が parent を持たないか (多段親禁止)」は
 * クロスモデルチェック (validateCrossModelReferences) 側で実施する。
 */
function validateParentRelation(
  parent: unknown,
  model: Partial<ModelDefinition>,
  path: string,
): string[] {
  const errors: string[] = [];
  if (typeof parent !== 'object' || parent === null) {
    return [`${path}: must be an object`];
  }
  const p = parent as Partial<ParentRelation>;
  if (typeof p.model !== 'string' || p.model.trim() === '') {
    errors.push(`${path}.model: must be non-empty string`);
  }
  if (typeof p.via !== 'string' || p.via.trim() === '') {
    errors.push(`${path}.via: must be non-empty string`);
  }
  if (errors.length > 0) return errors;

  // via で指定された field が自モデルに存在するか
  if (!Array.isArray(model.fields)) return errors;
  const viaField = model.fields.find((f) => {
    if (typeof f !== 'object' || f === null) return false;
    return (f as Partial<FieldDefinition>).name === p.via;
  }) as Partial<FieldDefinition> | undefined;
  if (!viaField) {
    errors.push(`${path}.via: "${p.via}" is not a field of this model`);
    return errors;
  }
  if (viaField.type !== 'reference') {
    errors.push(`${path}.via: field "${p.via}" must have type "reference"`);
    return errors;
  }
  if (typeof viaField.targetModel === 'string' && viaField.targetModel !== p.model) {
    errors.push(
      `${path}.model: "${p.model}" must match field "${p.via}".targetModel ("${viaField.targetModel}")`,
    );
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
  const u = ui as { buttons?: unknown; builtinButtonOverrides?: unknown; layout?: unknown };
  if (u.layout !== undefined) {
    if (typeof u.layout !== 'string' || !SCREEN_LAYOUTS.includes(u.layout as ScreenLayout)) {
      errors.push(`${path}.layout: must be one of ${SCREEN_LAYOUTS.join(', ')}`);
    }
  }
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

  // モデル単位のバリデーションを通った後で「モデル間」の整合性を確認する。
  // 個別フィールドが壊れていると targetModel 解決が無意味なので、後段で実施。
  errors.push(...validateCrossModelReferences(d.models));

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * reference フィールドの targetModel / targetLabelField がドキュメント内のモデル/フィールドを
 * 指しているか確認する。クロスモデルチェックは validateModelDefinition では行えないためここに集約。
 */
function validateCrossModelReferences(models: unknown[]): string[] {
  const errors: string[] = [];
  // モデル名 → フィールド名集合 を構築
  const fieldNamesByModel = new Map<string, Set<string>>();
  for (const m of models) {
    if (typeof m !== 'object' || m === null) continue;
    const mm = m as Partial<ModelDefinition>;
    if (typeof mm.name !== 'string' || !Array.isArray(mm.fields)) continue;
    const names = new Set<string>();
    for (const f of mm.fields) {
      if (typeof f === 'object' && f !== null) {
        const fn = (f as Partial<FieldDefinition>).name;
        if (typeof fn === 'string') names.add(fn);
      }
    }
    fieldNamesByModel.set(mm.name, names);
  }

  models.forEach((m, mi) => {
    if (typeof m !== 'object' || m === null) return;
    const mm = m as Partial<ModelDefinition>;
    if (!Array.isArray(mm.fields)) return;
    mm.fields.forEach((f, fi) => {
      if (typeof f !== 'object' || f === null) return;
      const ff = f as Partial<FieldDefinition>;
      if (ff.type !== 'reference') return;
      const path = `document.models[${mi}].fields[${fi}]`;
      if (typeof ff.targetModel === 'string' && ff.targetModel.trim() !== '') {
        const targetFields = fieldNamesByModel.get(ff.targetModel);
        if (!targetFields) {
          errors.push(`${path}.targetModel: "${ff.targetModel}" does not match any model in document`);
        } else if (
          typeof ff.targetLabelField === 'string' &&
          ff.targetLabelField.trim() !== '' &&
          !targetFields.has(ff.targetLabelField)
        ) {
          errors.push(
            `${path}.targetLabelField: "${ff.targetLabelField}" is not a field of model "${ff.targetModel}"`,
          );
        }
      }
    });
  });

  // 親子関係 (parent) のクロスモデルチェック。
  // 親モデルが実在し、かつ親モデル自身が parent を持たない (= 多段親禁止) ことを確認。
  const modelsByName = new Map<string, Partial<ModelDefinition>>();
  for (const m of models) {
    if (typeof m !== 'object' || m === null) continue;
    const mm = m as Partial<ModelDefinition>;
    if (typeof mm.name === 'string') modelsByName.set(mm.name, mm);
  }
  models.forEach((m, mi) => {
    if (typeof m !== 'object' || m === null) return;
    const mm = m as Partial<ModelDefinition>;
    if (!mm.parent) return;
    const path = `document.models[${mi}].parent`;
    const parentModelName = (mm.parent as Partial<ParentRelation>).model;
    if (typeof parentModelName !== 'string') return; // フィールド単位で既にエラー済
    const parentModel = modelsByName.get(parentModelName);
    if (!parentModel) {
      errors.push(`${path}.model: "${parentModelName}" does not match any model in document`);
      return;
    }
    // v1 では多段親 (親自身が parent を持つ) を禁止する
    if (parentModel.parent) {
      errors.push(
        `${path}.model: "${parentModelName}" is itself a child model; nested master-detail is not supported`,
      );
    }
  });

  return errors;
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
    const isRequired = field.required || field.primaryKey === true;
    if (isRequired && isEmpty) {
      errors.push(`${field.name}: is required`);
      continue;
    }
    if (isEmpty) continue; // optional な空値は OK

    switch (field.type) {
      case 'string':
      case 'reference': // reference も基本は ID なので string
      case 'id': // id 型も文字列
        if (typeof value !== 'string') {
          errors.push(`${field.name}: must be string`);
        } else {
          if (field.validation) {
            if (field.validation.minLength !== undefined && value.length < field.validation.minLength) {
              errors.push(`${field.name}: must be at least ${field.validation.minLength} characters`);
            }
            if (field.validation.maxLength !== undefined && value.length > field.validation.maxLength) {
              errors.push(`${field.name}: must be at most ${field.validation.maxLength} characters`);
            }
            if (field.validation.pattern) {
              try {
                const regex = new RegExp(field.validation.pattern);
                if (!regex.test(value)) {
                  errors.push(`${field.name}: must match pattern ${field.validation.pattern}`);
                }
              } catch (e) {
                // invalid regex
              }
            }
          }
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${field.name}: must be number`);
        } else {
          if (field.validation) {
            if (field.validation.min !== undefined && value < field.validation.min) {
              errors.push(`${field.name}: must be at least ${field.validation.min}`);
            }
            if (field.validation.max !== undefined && value > field.validation.max) {
              errors.push(`${field.name}: must be at most ${field.validation.max}`);
            }
          }
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

/**
 * 保存前にレコードの入力値を自動フォーマット（クレンジング）する。
 * trim や 全角半角変換 などを適用した新しいレコードオブジェクトを返す。
 */
export function formatRecord(
  model: ModelDefinition,
  record: Record<string, unknown>
): Record<string, unknown> {
  const formatted: Record<string, unknown> = { ...record };

  for (const field of model.fields) {
    if (!field.formatters) continue;
    let value = formatted[field.name];

    if (typeof value === 'string') {
      let strVal = value;
      if (field.formatters.fullWidthToHalfWidth) {
        strVal = strVal.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
          String.fromCharCode(s.charCodeAt(0) - 0xfee0)
        );
      }
      if (field.formatters.trim) {
        strVal = strVal.trim();
      }
      formatted[field.name] = strVal;
    }
  }

  return formatted;
}
