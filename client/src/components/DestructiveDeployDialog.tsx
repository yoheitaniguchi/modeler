/**
 * 破壊的なスキーマ変更が検出された際の確認モーダル。
 *
 * サーバーは 409 + warnings を返し、ここで内容を表示してユーザーが
 * 「強制デプロイ」を選んだ場合のみ ?force=true で再送する。
 */
export function DestructiveDeployDialog({
  warnings,
  onConfirm,
  onCancel,
}: {
  warnings: string[];
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="destructive-deploy-title"
      data-testid="destructive-deploy-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="card"
        style={{
          background: 'white',
          padding: '1.5rem',
          maxWidth: '560px',
          width: '90%',
          borderRadius: '6px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
        }}
      >
        <h3 id="destructive-deploy-title" style={{ marginTop: 0, color: '#b91c1c' }}>
          破壊的変更の確認
        </h3>
        <p>
          以下の変更にはデータ消失や DDL 失敗のリスクがあります。
          続行するとデータが復元できなくなる可能性があります。
        </p>
        <ul data-testid="destructive-warnings" style={{ marginTop: '0.5rem' }}>
          {warnings.map((w, i) => (
            <li key={i} style={{ marginBottom: '0.25rem' }}>
              {w}
            </li>
          ))}
        </ul>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            marginTop: '1rem',
          }}
        >
          <button
            type="button"
            className="ghost"
            onClick={onCancel}
            data-testid="destructive-cancel"
          >
            キャンセル
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              void onConfirm();
            }}
            data-testid="destructive-confirm"
            style={{
              background: '#dc2626',
              color: 'white',
              border: 'none',
              padding: '0.45rem 0.9rem',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            強制デプロイ
          </button>
        </div>
      </div>
    </div>
  );
}
