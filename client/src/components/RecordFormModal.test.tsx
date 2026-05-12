import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { RecordFormModal } from './RecordFormModal.js';
import type { ModelDefinition, Record as ModelRecord } from '@modeler/shared';

const mockModel: ModelDefinition = {
  name: 'customer',
  label: '顧客',
  fields: [
    { name: 'name', label: '氏名', type: 'string', required: true },
    { name: 'age', label: '年齢', type: 'number', required: false },
  ],
};

describe('RecordFormModal', () => {
  it('モーダルが閉じている時は何も表示しない', () => {
    const { container } = render(
      <RecordFormModal
        open={false}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container.querySelector('.modal-overlay')).not.toBeInTheDocument();
  });

  it('モーダルが開いている時にUIが表示される', () => {
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByTestId('record-form-modal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登録して閉じる' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登録してもう一件登録する' })).toBeInTheDocument();
  });

  it('必須フィールドのラベルが赤色で表示される', () => {
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    const nameLabel = screen.getByText('氏名');
    expect(nameLabel).toHaveStyle('color: #dc2626');
  });

  it('非必須フィールドのラベルが通常色で表示される', () => {
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    const ageLabel = screen.getByText('年齢');
    expect(ageLabel).toHaveStyle('color: #555');
  });

  it('新規作成モードの場合、フォームは空で初期化される', () => {
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    const nameInput = screen.getByPlaceholderText('氏名 *') as HTMLInputElement;
    expect(nameInput).toHaveValue('');
  });

  it('編集モードの場合、レコードデータがフォームに入力される', () => {
    const record: ModelRecord = { id: '1', name: 'Alice', age: 30 };
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={record}
        isEdit={true}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    const nameInput = screen.getByDisplayValue('Alice') as HTMLInputElement;
    const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(ageInput).toBeInTheDocument();
  });

  it('バリデーションエラーがモーダル上部に表示される', () => {
    const errors = ['エラー1', 'エラー2'];
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={errors}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByTestId('modal-errors')).toBeInTheDocument();
    expect(screen.getByText('エラー1')).toBeInTheDocument();
    expect(screen.getByText('エラー2')).toBeInTheDocument();
  });

  it('「登録して閉じる」ボタンをクリックすると、keepOpen=false で onSave が呼ばれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={onSave}
        onCancel={() => {}}
      />
    );
    const button = screen.getByRole('button', { name: '登録して閉じる' });
    await user.click(button);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', age: '' }),
      false
    );
  });

  it('「登録してもう一件登録する」ボタンをクリックすると、keepOpen=true で onSave が呼ばれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={onSave}
        onCancel={() => {}}
      />
    );
    const button = screen.getByRole('button', { name: '登録してもう一件登録する' });
    await user.click(button);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', age: '' }),
      true
    );
  });

  it('キャンセルボタンをクリックすると、onCancel が呼ばれる', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={onCancel}
      />
    );
    const button = screen.getByRole('button', { name: 'キャンセル' });
    await user.click(button);
    expect(onCancel).toHaveBeenCalled();
  });

  it('saving=true の時、ボタンが disabled になる', () => {
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={true}
        errors={[]}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: '登録して閉じる' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '登録してもう一件登録する' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  });

  it('フォーム入力値が変わると onSave に反映される', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={onSave}
        onCancel={() => {}}
      />
    );
    const nameInput = screen.getByPlaceholderText('氏名 *') as HTMLInputElement;
    const ageInput = screen.getByPlaceholderText('年齢') as HTMLInputElement;

    await user.type(nameInput, 'Bob');
    await user.type(ageInput, '25');

    const button = screen.getByRole('button', { name: '登録して閉じる' });
    await user.click(button);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob', age: 25 }),
      false
    );
  });

  it('Escape キーでモーダルを閉じることができる', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = render(
      <RecordFormModal
        open={true}
        model={mockModel}
        initialRecord={null}
        isEdit={false}
        saving={false}
        errors={[]}
        onSave={() => {}}
        onCancel={onCancel}
      />
    );
    const modal = container.querySelector('.modal-overlay');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});
