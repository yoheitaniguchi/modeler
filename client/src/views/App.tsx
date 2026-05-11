import { useMemo } from 'react';
import { HttpApiClient } from '../services/api.js';
import { AppShell } from '../components/AppShell.js';

/**
 * ルートコンポーネント。
 *
 * シェル (ヘッダー + 左サイドバー + メインペイン) を AppShell に委譲する。
 * モード切替 (管理者 / ユーザー) と ViewModel の管理は AppShell が担当する。
 */
export function App() {
  const api = useMemo(() => new HttpApiClient(), []);
  return <AppShell api={api} />;
}
