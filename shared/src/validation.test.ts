import { describe, expect, it } from 'vitest';
import { validateDocument, validateRecord } from './validation.js';
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
          ],
        },
      ],
    };
    expect(validateDocument(goodDefault)).toEqual({ ok: true });
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
});
