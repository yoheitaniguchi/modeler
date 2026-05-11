import { useEffect, useRef, useState } from 'react';

/**
 * サイドバーのモデル行に置く ⋮ ケバブメニュー。
 *
 * 確定 UX (画面レイアウト 2026-05-11):
 *   行アクション (定義編集 / 上へ / 下へ / 削除) を 1 つのケバブに集約する。
 *
 * Task 4 ではまず「↑ 1 つ上へ / ↓ 1 つ下へ」を実装する。
 * 「定義を編集」「モデルを削除」は Task 6 で同じケバブに追加する。
 *
 * パターンは SqlExportButton と同じ — 外側クリック / Esc で閉じる absolute popover。
 */

export interface ModelRowKebabProps {
  /** e2e セレクタ用のキー (モデル名 or __clientId)。 */
  rowKey: string;
  /** モデルが先頭か。先頭なら「上へ」disable。 */
  isFirst: boolean;
  /** モデルが末尾か。末尾なら「下へ」disable。 */
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function ModelRowKebab({
  rowKey,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: ModelRowKebabProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handle = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={wrapperRef} className="row-kebab-wrap">
      <button
        type="button"
        className="row-kebab"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="操作メニュー"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        data-testid={`model-row-kebab-${rowKey}`}
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="row-kebab-menu">
          <button
            type="button"
            role="menuitem"
            className="row-kebab-menuitem"
            onClick={handle(onMoveUp)}
            disabled={isFirst}
            data-testid="action-move-up"
          >
            ↑ 1つ上へ
          </button>
          <button
            type="button"
            role="menuitem"
            className="row-kebab-menuitem"
            onClick={handle(onMoveDown)}
            disabled={isLast}
            data-testid="action-move-down"
          >
            ↓ 1つ下へ
          </button>
        </div>
      )}
    </div>
  );
}
