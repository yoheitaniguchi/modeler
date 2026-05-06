import { useEffect } from 'react';

/**
 * 単純な確認ダイアログ。
 *  - モーダルレイヤーは CSS で固定 (.modal-overlay)
 *  - Escape キーで cancel
 *  - 「OK」「キャンセル」のシンプル 2 択。message は改行を含んでよい。
 */
export function ConfirmDialog({
  open,
  message,
  okLabel = 'OK',
  cancelLabel = 'キャンセル',
  onOk,
  onCancel,
}: {
  open: boolean;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  onOk: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" data-testid="confirm-dialog">
      <div className="modal">
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{message}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onCancel} data-testid="confirm-cancel">
            {cancelLabel}
          </button>
          <button className="primary" onClick={onOk} data-testid="confirm-ok">
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
