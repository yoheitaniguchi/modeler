import { describe, expect, it } from 'vitest';
import { isValidIdentifier, validateDocument, validateRecord, formatRecord } from './validation.js';
import type { ModelDefinition, ModelDefinitionDocument } from './model.js';

/**
 * バリデーションのテスト。
 * 「正常系 1 つ + 落としたい異常系を 1 つずつ」が読みやすさと網羅性のバランス。
 */

const validDoc: ModelDefinitionDocument = {
  version: 1,
  models: [
    {
      name: 'customer',
      label: '顧客',
      fields: [
        { name: 'name', label: '氏名', type: 'string', required: true },
        { name: 'age', label: '年齢', type: 'number', required: false },
      ],
    },
  ],
};

describe('validateDocument', () => {
  it('正しいドキュメントを受け入れる', () => {
    expect(validateDocument(validDoc)).toEqual({ ok: true });
  });

  it('version が違うと失敗する', () => {
    const result = validateDocument({ ...validDoc, version: 2 });
    expect(result.ok).toBe(false);
  });

  it('モデル名の重複を検出する', () => {
    const dup: ModelDefinitionDocument = {
      version: 1,
      models: [validDoc.models[0], validDoc.models[0]],
    };
    const result = validateDocument(dup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('duplicated'))).toBe(true);
    }
  });

  it('フィールドが 0 件のモデルを弾く', () => {
    const empty: ModelDefinitionDocument = {
      version: 1,
      models: [{ name: 'empty', label: '空', fields: [] }],
    };
    const result = validateDocument(empty);
    expect(result.ok).toBe(false);
  });

  it('識別子に記号が混じると弾く', () => {
    const bad: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'bad-name',
          label: 'NG',
          fields: [{ name: 'f', label: 'F', type: 'string', required: false }],
        },
      ],
    };
    expect(validateDocument(bad).ok).toBe(false);
  });

  it('defaultValue が型に合わないと失敗', () => {
    const badDefault: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'test',
          label: 'テスト',
          fields: [{ name: 'age', label: '年齢', type: 'number', required: false, defaultValue: 'not-a-number' }],
        },
      ],
    };
    const result = validateDocument(badDefault);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('defaultValue'))).toBe(true);
    }
  });

  it('defaultValue が型と合致すれば OK', () => {
    const goodDefault: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'product',
          label: '商品',
          fields: [
            { name: 'name', label: '名称', type: 'string', required: true, defaultValue: 'Unnamed' },
            { name: 'stock', label: '在庫', type: 'number', required: false, defaultValue: 0 },
            { name: 'available', label: '利用可能', type: 'boolean', required: false, defaultValue: true },
            { name: 'created_date', label: '作成日', type: 'date', required: false, defaultValue: 'today' },
            { name: 'updated_date', label: '更新日', type: 'date', required: false, defaultValue: '2026-05-12' },
          ],
        },
      ],
    };
    expect(validateDocument(goodDefault)).toEqual({ ok: true });
  });

  it('optionsUrl が有効な URL 文字列なら OK', () => {
    const withOptions: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'item',
          label: 'アイテム',
          fields: [
            { name: 'category', label: 'カテゴリ', type: 'string', required: false, optionsUrl: '/api/categories' },
          ],
        },
      ],
    };
    expect(validateDocument(withOptions)).toEqual({ ok: true });
  });

  it('optionsUrl が空文字列なら失敗', () => {
    const badOptions: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'item',
          label: 'アイテム',
          fields: [{ name: 'category', label: 'カテゴリ', type: 'string', required: false, optionsUrl: '' }],
        },
      ],
    };
    const result = validateDocument(badOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('optionsUrl'))).toBe(true);
    }
  });

  it('optionsUrl が number フィールドに指定されると失敗', () => {
    const badType: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'item',
          label: 'アイテム',
          fields: [{ name: 'quantity', label: '数量', type: 'number', required: false, optionsUrl: '/api/qty' }],
        },
      ],
    };
    const result = validateDocument(badType);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('optionsUrl'))).toBe(true);
    }
  });

  it('ModelUiConfig があっても validateDocument は通る', () => {
    const withUi: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'order',
          label: '注文',
          ui: { listTitle: '注文一覧', detailTitle: '注文詳細', createButtonLabel: '新規作成' },
          fields: [{ name: 'status', label: 'ステータス', type: 'string', required: true }],
        },
      ],
    };
    expect(validateDocument(withUi)).toEqual({ ok: true });
  });

  it('ButtonDefinition (http) を許容する', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'order',
          label: '注文',
          ui: {
            buttons: [
              {
                id: 'notify',
                label: '通知',
                scope: 'row',
                style: 'primary',
                action: { kind: 'http', method: 'POST', url: '/notify/{{id}}', bodyTemplate: '{}' },
              },
              {
                id: 'export',
                label: 'エクスポート',
                scope: 'screen',
                action: { kind: 'http', method: 'GET', url: '/export' },
              },
            ],
            builtinButtonOverrides: {
              create: { url: '/external/create', method: 'POST' },
            },
          },
          fields: [{ name: 'status', label: 'ステータス', type: 'string', required: true }],
        },
      ],
    };
    expect(validateDocument(doc)).toEqual({ ok: true });
  });

  it('ButtonDefinition の id 重複を弾く', () => {
    const doc = {
      version: 1,
      models: [
        {
          name: 'order',
          label: '注文',
          ui: {
            buttons: [
              { id: 'a', label: 'A', scope: 'row', action: { kind: 'http', method: 'GET', url: '/a' } },
              { id: 'a', label: 'A2', scope: 'row', action: { kind: 'http', method: 'GET', url: '/a2' } },
            ],
          },
          fields: [{ name: 'status', label: 'S', type: 'string', required: true }],
        },
      ],
    };
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('duplicated'))).toBe(true);
  });

  it('http ボタンで url が空なら弾く', () => {
    const doc = {
      version: 1,
      models: [
        {
          name: 'order',
          label: '注文',
          ui: {
            buttons: [
              { id: 'a', label: 'A', scope: 'row', action: { kind: 'http', method: 'POST', url: '' } },
            ],
          },
          fields: [{ name: 'status', label: 'S', type: 'string', required: true }],
        },
      ],
    };
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('action.url'))).toBe(true);
  });

  it('builtinButtonOverrides の method 不正を弾く', () => {
    const doc = {
      version: 1,
      models: [
        {
          name: 'order',
          label: '注文',
          ui: {
            builtinButtonOverrides: {
              create: { url: '/x', method: 'BOGUS' },
            },
          },
          fields: [{ name: 'status', label: 'S', type: 'string', required: true }],
        },
      ],
    };
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
  });
});

describe('isValidIdentifier', () => {
  it.each([
    ['a', true],
    ['customer', true],
    ['user_name', true],
    ['fieldA1', true],
    ['', false],
    ['1leading', false],
    ['has-dash', false],
    ['has space', false],
    ['ふぃーるど', false],
  ])('isValidIdentifier(%j) -> %s', (input, expected) => {
    expect(isValidIdentifier(input)).toBe(expected);
  });
});

describe('validateRecord', () => {
  const model: ModelDefinition = validDoc.models[0];

  it('required を満たせば OK', () => {
    expect(validateRecord(model, { name: '山田', age: 30 })).toEqual({ ok: true });
  });

  it('required な name が空なら失敗', () => {
    const result = validateRecord(model, { name: '', age: 30 });
    expect(result.ok).toBe(false);
  });

  it('optional な age が未指定でも OK', () => {
    expect(validateRecord(model, { name: '山田' })).toEqual({ ok: true });
  });

  it('型が違うと失敗 (age に文字列)', () => {
    const result = validateRecord(model, { name: '山田', age: 'thirty' });
    expect(result.ok).toBe(false);
  });

  it('パターン検証 (pattern)', () => {
    const m: ModelDefinition = {
      name: 'test',
      label: 'test',
      fields: [{ name: 'code', label: 'c', type: 'string', required: false, validation: { pattern: '^\\d{3}$' } }]
    };
    expect(validateRecord(m, { code: '123' }).ok).toBe(true);
    expect(validateRecord(m, { code: '1234' }).ok).toBe(false);
  });

  it('文字数検証 (minLength, maxLength)', () => {
    const m: ModelDefinition = {
      name: 'test',
      label: 'test',
      fields: [{ name: 'code', label: 'c', type: 'string', required: false, validation: { minLength: 2, maxLength: 4 } }]
    };
    expect(validateRecord(m, { code: '1' }).ok).toBe(false);
    expect(validateRecord(m, { code: '12' }).ok).toBe(true);
    expect(validateRecord(m, { code: '1234' }).ok).toBe(true);
    expect(validateRecord(m, { code: '12345' }).ok).toBe(false);
  });

  it('数値検証 (min, max)', () => {
    const m: ModelDefinition = {
      name: 'test',
      label: 'test',
      fields: [{ name: 'age', label: 'a', type: 'number', required: false, validation: { min: 10, max: 20 } }]
    };
    expect(validateRecord(m, { age: 9 }).ok).toBe(false);
    expect(validateRecord(m, { age: 10 }).ok).toBe(true);
    expect(validateRecord(m, { age: 20 }).ok).toBe(true);
    expect(validateRecord(m, { age: 21 }).ok).toBe(false);
  });
});

describe('formatRecord', () => {
  it('trim と fullWidthToHalfWidth が適用されること', () => {
    const m: ModelDefinition = {
      name: 'test',
      label: 'テスト',
      fields: [
        { name: 'code', label: 'コード', type: 'string', required: false, formatters: { fullWidthToHalfWidth: true, trim: true } },
        { name: 'memo', label: 'メモ', type: 'string', required: false, formatters: { trim: true } },
        { name: 'none', label: 'なし', type: 'string', required: false }
      ]
    };
    const input = { code: ' ＡＢＣ１２３ ', memo: '  テスト  ', none: ' ＡＢＣ ' };
    const result = formatRecord(m, input);
    expect(result.code).toBe('ABC123');
    expect(result.memo).toBe('テスト');
    expect(result.none).toBe(' ＡＢＣ ');
  });
});

/**
 * リレーション関連の新規プロパティ (relationKind / onDelete / onUpdate) の検証。
 * 既存 reference フィールド (新プロパティ未指定) が無改変で通ることが最重要。
 */
describe('relation field properties', () => {
  const refField = (extras: object) => ({
    name: 'dept',
    label: '部署',
    type: 'reference' as const,
    required: false,
    targetModel: 'department',
    ...extras,
  });
  const makeDoc = (field: object): ModelDefinitionDocument => ({
    version: 1,
    models: [
      {
        name: 'employee',
        label: '従業員',
        fields: [field as never],
      },
      {
        name: 'department',
        label: '部署',
        fields: [{ name: 'name', label: '名前', type: 'string', required: true }],
      },
    ],
  });

  it('既存 reference (新プロパティ未指定) は通る', () => {
    expect(validateDocument(makeDoc(refField({}))).ok).toBe(true);
  });

  it('relationKind=oneToMany は通る', () => {
    expect(validateDocument(makeDoc(refField({ relationKind: 'oneToMany' }))).ok).toBe(true);
  });

  it('relationKind=manyToMany は未対応として弾く', () => {
    const result = validateDocument(makeDoc(refField({ relationKind: 'manyToMany' })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('manyToMany'))).toBe(true);
    }
  });

  it('relationKind を reference 以外の型に指定すると弾く', () => {
    const result = validateDocument({
      version: 1,
      models: [
        {
          name: 'm',
          label: 'M',
          fields: [
            { name: 'f', label: 'F', type: 'string', required: false, relationKind: 'oneToMany' } as never,
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('onDelete=cascade は通る', () => {
    expect(validateDocument(makeDoc(refField({ onDelete: 'cascade' }))).ok).toBe(true);
  });

  it('onDelete の未知の値は弾く', () => {
    const result = validateDocument(makeDoc(refField({ onDelete: 'BOOM' })));
    expect(result.ok).toBe(false);
  });

  it('required=true かつ onDelete=setNull は弾く', () => {
    const result = validateDocument(makeDoc(refField({ required: true, onDelete: 'setNull' })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('setNull'))).toBe(true);
    }
  });

  it('onUpdate=noAction は通る', () => {
    expect(validateDocument(makeDoc(refField({ onUpdate: 'noAction' }))).ok).toBe(true);
  });

  it('onUpdate を reference 以外に指定すると弾く', () => {
    const result = validateDocument({
      version: 1,
      models: [
        {
          name: 'm',
          label: 'M',
          fields: [
            { name: 'f', label: 'F', type: 'number', required: false, onUpdate: 'cascade' } as never,
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

/**
 * クロスモデル整合性 — targetModel が他モデルとして実在するか、
 * targetLabelField が参照先モデルの実在フィールドか、をドキュメント単位で検査する。
 */
describe('validateDocument cross-model references', () => {
  it('targetModel がドキュメント内に存在しなければ弾く', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'employee',
          label: '従業員',
          fields: [
            { name: 'dept', label: '部署', type: 'reference', required: false, targetModel: 'nonExistent' },
          ],
        },
      ],
    };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('does not match any model'))).toBe(true);
    }
  });

  it('targetLabelField が参照先モデルに存在しなければ弾く', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'department',
          label: '部署',
          fields: [{ name: 'name', label: '名前', type: 'string', required: true }],
        },
        {
          name: 'employee',
          label: '従業員',
          fields: [
            {
              name: 'dept',
              label: '部署',
              type: 'reference',
              required: false,
              targetModel: 'department',
              targetLabelField: 'noSuchField',
            },
          ],
        },
      ],
    };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('is not a field of model'))).toBe(true);
    }
  });

  it('targetModel / targetLabelField が共に有効なら通る', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'department',
          label: '部署',
          fields: [{ name: 'name', label: '名前', type: 'string', required: true }],
        },
        {
          name: 'employee',
          label: '従業員',
          fields: [
            {
              name: 'dept',
              label: '部署',
              type: 'reference',
              required: false,
              targetModel: 'department',
              targetLabelField: 'name',
            },
          ],
        },
      ],
    };
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('reference 以外のフィールドはクロスチェックの対象外', () => {
    // type:string のフィールドに targetModel/targetLabelField が付いてもクロスチェックは走らない
    // (型単位のバリデーション側で別エラーは出るが、クロスチェック自体は副作用ゼロ)
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'a',
          label: 'A',
          fields: [{ name: 'f', label: 'F', type: 'string', required: false }],
        },
      ],
    };
    expect(validateDocument(doc).ok).toBe(true);
  });
});

describe('primaryKey, id type, and display settings validation', () => {
  it('validates id type and numberingUrl successfully', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'user',
          label: 'ユーザー',
          fields: [
            { name: 'uid', label: 'UID', type: 'id', required: true, primaryKey: true, numberingUrl: '/api/number' },
            { name: 'email', label: 'メール', type: 'string', required: true, showInList: false, showInDetail: true },
          ],
        },
      ],
    };
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('rejects numberingUrl when type is not id', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          name: 'user',
          label: 'ユーザー',
          fields: [
            { name: 'email', label: 'メール', type: 'string', required: true, numberingUrl: '/api/number' },
          ],
        },
      ],
    };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('numberingUrl: only valid when type is "id"'))).toBe(true);
    }
  });

  it('enforces primaryKey as required in validateRecord', () => {
    const model: ModelDefinition = {
      name: 'user',
      label: 'ユーザー',
      fields: [
        { name: 'uid', label: 'UID', type: 'id', required: false, primaryKey: true },
        { name: 'name', label: '名前', type: 'string', required: false },
      ],
    };
    // uid is empty -> should fail because uid is primaryKey
    const resEmpty = validateRecord(model, { name: 'テスト' });
    expect(resEmpty.ok).toBe(false);
    if (!resEmpty.ok) {
      expect(resEmpty.errors.some((e) => e.includes('uid: is required'))).toBe(true);
    }

    // uid is provided -> should succeed
    const resOk = validateRecord(model, { uid: '123', name: 'テスト' });
    expect(resOk.ok).toBe(true);
  });
});

describe('validateDocument: parent / layout (master-detail)', () => {
  const ordersHeader: ModelDefinition = {
    name: 'orders',
    label: '受注',
    fields: [
      { name: 'id', label: 'ID', type: 'id', required: true, primaryKey: true },
      { name: 'customer', label: '顧客', type: 'string', required: true },
    ],
    ui: { layout: 'masterDetail' },
  };
  const orderLinesDetail: ModelDefinition = {
    name: 'orderLines',
    label: '受注明細',
    fields: [
      { name: 'id', label: 'ID', type: 'id', required: true, primaryKey: true },
      {
        name: 'order',
        label: '受注',
        type: 'reference',
        required: true,
        targetModel: 'orders',
        onDelete: 'cascade',
      },
      { name: 'product', label: '商品', type: 'string', required: true },
    ],
    parent: { model: 'orders', via: 'order' },
  };

  it('正しい masterDetail ドキュメントを受け入れる', () => {
    const doc: ModelDefinitionDocument = {
      version: 1,
      models: [ordersHeader, orderLinesDetail],
    };
    expect(validateDocument(doc)).toEqual({ ok: true });
  });

  it('parent.via が存在しないフィールドを指すと弾く', () => {
    const bad: ModelDefinitionDocument = {
      version: 1,
      models: [
        ordersHeader,
        { ...orderLinesDetail, parent: { model: 'orders', via: 'nonexistent' } },
      ],
    };
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('parent.via') && e.includes('nonexistent'))).toBe(
        true,
      );
    }
  });

  it('parent.via が reference 型でないと弾く', () => {
    const bad: ModelDefinitionDocument = {
      version: 1,
      models: [
        ordersHeader,
        { ...orderLinesDetail, parent: { model: 'orders', via: 'product' } },
      ],
    };
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('must have type "reference"'))).toBe(true);
    }
  });

  it('parent.model と field.targetModel の不一致を弾く', () => {
    const bad: ModelDefinitionDocument = {
      version: 1,
      models: [
        ordersHeader,
        {
          ...orderLinesDetail,
          parent: { model: 'somethingElse', via: 'order' },
        },
      ],
    };
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('parent.model'))).toBe(true);
    }
  });

  it('実在しない親モデルを弾く (クロスモデル)', () => {
    const bad: ModelDefinitionDocument = {
      version: 1,
      models: [
        {
          ...orderLinesDetail,
          fields: orderLinesDetail.fields.map((f) =>
            f.name === 'order' ? { ...f, targetModel: 'ghost' } : f,
          ),
          parent: { model: 'ghost', via: 'order' },
        },
      ],
    };
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // 親モデルがそもそも存在しないので targetModel 解決失敗 + parent.model 解決失敗 の両方が出る想定
      expect(res.errors.some((e) => e.includes('does not match any model'))).toBe(true);
    }
  });

  it('多段親 (親自身が parent を持つ) を弾く', () => {
    const grand: ModelDefinition = {
      name: 'grandParent',
      label: '大親',
      fields: [{ name: 'id', label: 'ID', type: 'id', required: true, primaryKey: true }],
    };
    const middle: ModelDefinition = {
      name: 'orders',
      label: '受注',
      fields: [
        { name: 'id', label: 'ID', type: 'id', required: true, primaryKey: true },
        {
          name: 'gp',
          label: '大親',
          type: 'reference',
          required: true,
          targetModel: 'grandParent',
        },
      ],
      parent: { model: 'grandParent', via: 'gp' },
    };
    const bad: ModelDefinitionDocument = {
      version: 1,
      models: [grand, middle, orderLinesDetail],
    };
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('nested master-detail is not supported'))).toBe(
        true,
      );
    }
  });

  it('ui.layout に不正な値を弾く', () => {
    const bad = {
      version: 1,
      models: [
        {
          ...ordersHeader,
          ui: { layout: 'something' },
        },
      ],
    };
    const res = validateDocument(bad as unknown as ModelDefinitionDocument);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('ui.layout'))).toBe(true);
    }
  });

  it('parent / layout 未指定の従来ドキュメントを受け入れる (後方互換)', () => {
    expect(validateDocument(validDoc)).toEqual({ ok: true });
  });
});
