import { useAuthStore } from '../stores/authStore'

export function useAuth() {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail)
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const signOut = useAuthStore((s) => s.signOut)
  const sendPasswordResetEmail = useAuthStore((s) => s.sendPasswordResetEmail)

  return {
    user,
    loading,
    signIn: signInWithEmail,
    signUp: signUpWithEmail,
    signInWithGoogle,
    signOut,
    sendPasswordResetEmail,
  }
}
