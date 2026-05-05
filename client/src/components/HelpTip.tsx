/**
 * インラインヘルプ用のアイコン。
 *
 * 使用例:
 *   <label>name <HelpTip text="英字始まり / 英数字とアンダースコアのみ" /></label>
 *
 * 設計上の判断:
 *   - ブラウザの title 属性をそのまま利用 (実装が簡単で、スクリーンリーダーも拾える)。
 *   - tabIndex=0 でキーボードフォーカス可能にし、視覚障害ユーザにもアクセス可能。
 */
export function HelpTip({ text, label }: { text: string; label?: string }) {
  return (
    <span
      className="help-tip"
      role="img"
      aria-label={label ?? 'ヘルプ'}
      title={text}
      tabIndex={0}
    >
      ?
    </span>
  );
}
