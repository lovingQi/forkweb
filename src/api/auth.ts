import axios from 'axios'
import { config } from '@/config'

const authHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 10000
})

authHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
})

export interface LoginInput {
  username: string
  password: string
}

export interface AuthUser {
  id: number
  username: string
  role: 'after_sales' | 'rd' | 'admin'
  displayName: string | null
  email: string | null
}

export async function login(input: LoginInput): Promise<{ token: string; user: AuthUser }> {
  const { data } = await authHttp.post('/auth/login', input)
  if (!data.succeed) throw new Error(data.error || '登录失败')
  localStorage.setItem('forkweb_user', JSON.stringify(data.user))
  return { token: data.token, user: data.user }
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const { data } = await authHttp.get('/auth/me')
    if (data.succeed && data.user) {
      localStorage.setItem('forkweb_user', JSON.stringify(data.user))
    }
    return data.succeed ? data.user : null
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  localStorage.removeItem('forkweb_token')
  localStorage.removeItem('forkweb_user')
}
