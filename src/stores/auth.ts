import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getMe, login as apiLogin, logout as apiLogout, type AuthUser } from '@/api/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const isLoggedIn = computed(() => !!user.value)
  const isRd = computed(() => user.value?.role === 'rd' || user.value?.role === 'admin')
  const isAfterSales = computed(() => user.value?.role === 'after_sales' || user.value?.role === 'admin')

  async function login(username: string, password: string) {
    loading.value = true
    try {
      const res = await apiLogin({ username, password })
      localStorage.setItem('forkweb_token', res.token)
      user.value = res.user
      return true
    } catch (e) {
      user.value = null
      throw e
    } finally {
      loading.value = false
    }
  }

  async function restoreSession() {
    const token = localStorage.getItem('forkweb_token')
    if (!token) {
      user.value = null
      return
    }
    try {
      user.value = await getMe()
    } catch {
      localStorage.removeItem('forkweb_token')
      user.value = null
    }
  }

  async function logout() {
    await apiLogout()
    user.value = null
  }

  return {
    user,
    loading,
    isLoggedIn,
    isRd,
    isAfterSales,
    login,
    restoreSession,
    logout
  }
})
