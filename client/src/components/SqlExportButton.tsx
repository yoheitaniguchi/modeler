import { useEffect, useRef, useState } from 'react';
import type { ModelDefinition } from '@modeler/shared';
import { downloadAsFile } from '../services/jsonIo.js';
import {
  buildSqlFilename,
  generateCreateTable,
  type SqlDialect,
} from '../services/sqlGenerator.js';

/**
 * モデル単位の CREATE TABLE SQL 出力ボタン。
 *
 * クリックでドロップダウンを開き、3 方言のいずれかを選ぶと SQL ファイルをダウンロードする。
 * 外側クリック / Esc で閉じる。
 * フィールド未定義のモデルでは alert でユーザーに通知し、出力しない。
 */

const OPTIONS: ReadonlyArray<{ dialect: SqlDialect; label: string }> = [
  { dialect: 'postgresql', label: 'PostgreSQL' },
  { dialect: 'sqlite', label: 'SQLite' },
  { dialect: 'msaccess', label: 'MS Access' },
];

export function SqlExportButton({ model }: { model: ModelDefinition }) {
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

  const onPick = (dialect: SqlDialect) => {
    setOpen(false);
    if (model.fields.length === 0) {
      window.alert('フィールドが0件のためSQLを生成できません');
      return;
    }
    try {
      const sql = generateCreateTable(model, dialect);
      const filename = buildSqlFilename(model.name, dialect);
      downloadAsFile(filename, sql, 'text/plain;charset=utf-8');
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="sql-export-button"
      >
        CREATE SQL生成 ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.25rem',
            background: 'white',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            zIndex: 10,
            minWidth: '10rem',
          }}
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.dialect}
              role="menuitem"
              className="ghost"
              onClick={() => onPick(opt.dialect)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderRadius: 0,
                background: 'white',
              }}
              data-testid={`sql-export-${opt.dialect}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
