import { describe, expect, it } from 'vitest';
import { buildRequestBody, renderTemplate, TemplateError } from './template.js';

describe('renderTemplate', () => {
  it('単純な置換', () => {
    expect(renderTemplate('hello {{name}}', { name: 'world' })).toBe('hello world');
  });
  it('複数の変数', () => {
    expect(
      renderTemplate('{{a}}-{{b}}', { a: 'x', b: 'y' }),
    ).toBe('x-y');
  });
  it('空白を含む変数', () => {
    expect(renderTemplate('{{ name }}', { name: 'Alice' })).toBe('Alice');
  });
  it('値が無いキーは空文字', () => {
    expect(renderTemplate('{{missing}}', {})).toBe('');
  });
  it('null/undefined は空文字', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: null, b: undefined })).toBe('-');
  });
  it('数値や真偽値は JSON 文字列化', () => {
    expect(renderTemplate('age={{age}},ok={{ok}}', { age: 30, ok: true })).toBe('age=30,ok=true');
  });
});

describe('buildRequestBody', () => {
  it('空の template は undefined', () => {
    expect(buildRequestBody(undefined, {})).toBeUndefined();
    expect(buildRequestBody('', {})).toBeUndefined();
  });
  it('JSON として有効なら parse', () => {
    const out = buildRequestBody('{"name":"{{name}}"}', { name: 'Alice' });
    expect(out).toEqual({ name: 'Alice' });
  });
  it('数値の埋め込み', () => {
    expect(
      buildRequestBody('{"age":{{age}}}', { age: 42 }),
    ).toEqual({ age: 42 });
  });
  it('JSON 不正なら TemplateError', () => {
    expect(() => buildRequestBody('{not json', {})).toThrow(TemplateError);
  });
});
