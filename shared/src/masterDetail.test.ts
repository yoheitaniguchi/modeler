import { describe, expect, it } from 'vitest';
import { getDetailModels, getParentField, isDetailModel, isHeaderModel } from './masterDetail.js';
import type { ModelDefinition, ModelDefinitionDocument } from './model.js';

const ordersHeader: ModelDefinition = {
  name: 'orders',
  label: '受注',
  fields: [
    { name: 'id', label: 'ID', type: 'id', required: true, primaryKey: true },
    { name: 'customer', label: '顧客', type: 'string', required: true },
  ],
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
    },
  ],
  parent: { model: 'orders', via: 'order' },
};
const doc: ModelDefinitionDocument = { version: 1, models: [ordersHeader, orderLinesDetail] };

describe('masterDetail helpers', () => {
  it('isHeaderModel: 他から指されているモデルを ヘッダー と判定', () => {
    expect(isHeaderModel(ordersHeader, doc)).toBe(true);
  });

  it('isHeaderModel: 誰からも指されないモデルは false', () => {
    expect(isHeaderModel(orderLinesDetail, doc)).toBe(false);
  });

  it('isDetailModel: parent を持つモデルは明細', () => {
    expect(isDetailModel(orderLinesDetail)).toBe(true);
    expect(isDetailModel(ordersHeader)).toBe(false);
  });

  it('getDetailModels: ヘッダーから直接の子を返す', () => {
    const details = getDetailModels(ordersHeader, doc);
    expect(details).toHaveLength(1);
    expect(details[0]?.name).toBe('orderLines');
  });

  it('getDetailModels: 子のないモデルは空配列', () => {
    expect(getDetailModels(orderLinesDetail, doc)).toEqual([]);
  });

  it('getParentField: parent.via に対応する field を返す', () => {
    const field = getParentField(orderLinesDetail);
    expect(field?.name).toBe('order');
    expect(field?.type).toBe('reference');
  });

  it('getParentField: parent 未指定の場合は undefined', () => {
    expect(getParentField(ordersHeader)).toBeUndefined();
  });
});
