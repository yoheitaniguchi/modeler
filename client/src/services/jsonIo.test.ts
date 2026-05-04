import { describe, expect, it } from 'vitest';
import { JsonParseError, parse, serialize } from './jsonIo.js';
import type { ModelDefinitionDocument } from '@modeler/shared';

describe('jsonIo', () => {
  const doc: ModelDefinitionDocument = {
    version: 1,
    models: [
      {
        name: 'customer',
        label: '顧客',
        fields: [{ name: 'name', label: '氏名', type: 'string', required: true }],
      },
    ],
  };

  it('serialize → parse でラウンドトリップ', () => {
    const text = serialize(doc);
    const back = parse(text);
    expect(back).toEqual(doc);
  });

  it('壊れた JSON は JsonParseError', () => {
    expect(() => parse('not json')).toThrow(JsonParseError);
  });

  it('スキーマ違反 (version=2) は JsonParseError', () => {
    expect(() => parse(JSON.stringify({ version: 2, models: [] }))).toThrow(JsonParseError);
  });
});
