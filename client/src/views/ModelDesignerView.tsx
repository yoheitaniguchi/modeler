import { useRef } from 'react';
import type { FieldType } from '@modeler/shared';
import type { ApiClient } from '../services/api.js';
import { downloadAsFile } from '../services/jsonIo.js';
import { useModelerViewModel } from '../viewmodels/useModelerViewModel.js';

/**
 * モデル設計 View。
 *
 * このコンポーネントには「ロジック」を一切書かないことを目指す:
 *   - 状態は ViewModel に持たせる
 *   - クリック時の処理も ViewModel のメソッドを呼ぶだけ
 * View の責務は「現在状態を画面に表示する」「ユーザー入力を ViewModel に伝える」のみ。
 */

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

/**
 * フィールド型に応じて、デフォルト値の入力を出し分ける。
 */
function DefaultValueInput({
  field,
  onChange,
}: {
  field: {type: FieldType; defaultValue?: unknown};
  onChange: (v: unknown) => void;
}) {
  const value = field.defaultValue;
  const clear = () => onChange(undefined);

  switch (field.type) {
    case 'string':
      return (
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="text"
            value={(value as string) ?? ''}
            placeholder="(なし)"
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            style={{ fontSize: '0.9rem', flex: 1 }}
          />
          {value !== undefined && <button className="ghost" onClick={clear} style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}>✕</button>}
        </div>
      );
    case 'number':
      return (
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="number"
            value={(value as number) ?? ''}
            placeholder="(なし)"
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            style={{ fontSize: '0.9rem', flex: 1 }}
          />
          {value !== undefined && <button className="ghost" onClick={clear} style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}>✕</button>}
        </div>
      );
    case 'date':
      return (
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            style={{ fontSize: '0.9rem', flex: 1 }}
          />
          {value !== undefined && <button className="ghost" onClick={clear} style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}>✕</button>}
        </div>
      );
    case 'boolean':
      return (
        <select
          value={value === undefined ? '' : String(value)}
          onChange={(e) => {
            if (e.target.value === '') onChange(undefined);
            else onChange(e.target.value === 'true');
          }}
          style={{ fontSize: '0.9rem' }}
        >
          <option value="">(なし)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
  }
}

export function ModelDesignerView({ api }: { api: ApiClient }) {
  const vm = useModelerViewModel(api);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 「保存」ボタン: ViewModel から JSON 文字列を取得 → ファイル化
  const onSave = () => {
    const json = vm.exportJson();
    if (json) downloadAsFile('model-definition.json', json);
  };

  // 「読み込み」ボタン: 隠した <input type="file"> をプログラムからクリック
  const onLoadClick = () => fileInputRef.current?.click();
  const onLoadFile = async (file: File) => {
    const text = await file.text();
    vm.importJson(text);
  };

  const onDeploy = async () => { await vm.deploy(); };

  return (
    <section>
      <p className="muted">
        マスタメンテナンス画面のモデルを定義します。フィールドを追加し、必要に応じて
        「必須 (NOT NULL)」を指定してください。完成したら「デプロイ」を押すと、定義通りの
        CRUD 画面と REST API が生成されます。
      </p>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="primary" onClick={vm.addModel}>+ モデル追加</button>
        <button className="ghost" onClick={onSave}>JSON 保存</button>
        <button className="ghost" onClick={onLoadClick}>JSON 読込</button>
        <button className="primary" onClick={onDeploy} disabled={vm.document.models.length === 0}>
          デプロイ
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onLoadFile(file);
            e.target.value = ''; // 同じファイルを連続選択しても onChange を発火させる
          }}
        />
      </div>

      {vm.errors.length > 0 && (
        <div className="errors" role="alert">
          <strong>エラー:</strong>
          <ul>{vm.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {vm.notice && <div className="notice">{vm.notice}</div>}

      {vm.document.models.length === 0 && (
        <p className="muted">まだモデルがありません。「+ モデル追加」から始めてください。</p>
      )}

      {vm.document.models.map((model, mi) => (
        <div className="card" key={mi}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <label>モデル名 <input
                type="text"
                value={model.name}
                placeholder="customer"
                onChange={(e) => vm.updateModel(mi, { name: e.target.value })}
              /></label>
              <label>ラベル <input
                type="text"
                value={model.label}
                placeholder="顧客"
                onChange={(e) => vm.updateModel(mi, { label: e.target.value })}
              /></label>
            </div>
            <button className="danger" onClick={() => vm.removeModel(mi)}>モデル削除</button>
          </div>

          <table style={{ marginTop: '0.6rem', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ width: '18%' }}>name</th>
                <th style={{ width: '18%' }}>label</th>
                <th style={{ width: '16%' }}>type</th>
                <th style={{ width: '12%' }}>必須</th>
                <th style={{ width: '22%' }}>デフォルト値</th>
                <th style={{ width: '8%' }}></th>
              </tr>
            </thead>
            <tbody>
              {model.fields.map((field, fi) => (
                <tr key={fi}>
                  <td>
                    <input
                      type="text"
                      value={field.name}
                      placeholder="e.g., email"
                      onChange={(e) => vm.updateField(mi, fi, { name: e.target.value })}
                      style={{ fontSize: '0.9rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={field.label}
                      placeholder="e.g., メール"
                      onChange={(e) => vm.updateField(mi, fi, { label: e.target.value })}
                      style={{ fontSize: '0.9rem' }}
                    />
                  </td>
                  <td>
                    <select
                      value={field.type}
                      onChange={(e) => vm.updateField(mi, fi, { type: e.target.value as FieldType })}
                      style={{ fontSize: '0.9rem' }}
                    >
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => vm.updateField(mi, fi, { required: e.target.checked })}
                    />
                  </td>
                  <td>
                    <DefaultValueInput
                      field={field}
                      onChange={(v) => vm.updateField(mi, fi, { defaultValue: v })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="danger"
                      onClick={() => vm.removeField(mi, fi)}
                      disabled={model.fields.length <= 1}
                      style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}
                    >削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="ghost" onClick={() => vm.addField(mi)} style={{ marginTop: '0.5rem' }}>
            + フィールド追加
          </button>
        </div>
      ))}
    </section>
  );
}
