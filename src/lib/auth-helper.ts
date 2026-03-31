import { useAuthStore } from '../stores/authStore'

/**
 * 現在のユーザーIDを返す。
 * 未ログイン（開発モード）の場合はダミーIDをフォールバックとして使用する。
 * 認証を有効にする際はここを変更するだけでよい。
 */
export function getCurrentUserId(): string {
  const user = useAuthStore.getState().user
  return user?.id ?? 'dev-user-00000000'
}
