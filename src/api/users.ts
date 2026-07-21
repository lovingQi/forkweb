import axios from 'axios'
import { config } from '@/config'

const userHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 10000
})

userHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
})

export interface User {
  id: number
  username: string
  role: 'after_sales' | 'rd' | 'admin'
  displayName: string | null
  email: string | null
  disabled: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface CreateUserInput {
  username: string
  password: string
  role: 'after_sales' | 'rd' | 'admin'
  displayName?: string
  email?: string
}

export interface UpdateUserInput {
  role?: 'after_sales' | 'rd' | 'admin'
  displayName?: string
  email?: string
  disabled?: boolean
}

export async function listUsers(): Promise<User[]> {
  const { data } = await userHttp.get('/auth/users')
  if (!data.succeed) throw new Error(data.error || '获取用户列表失败')
  return data.users
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const { data } = await userHttp.post('/auth/users', input)
  if (!data.succeed) throw new Error(data.error || '创建用户失败')
  return data.user
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<User> {
  const { data } = await userHttp.put(`/auth/users/${id}`, input)
  if (!data.succeed) throw new Error(data.error || '更新用户失败')
  return data.user
}

export async function resetPassword(id: number, password: string): Promise<User> {
  const { data } = await userHttp.put(`/auth/users/${id}`, { password })
  if (!data.succeed) throw new Error(data.error || '重置密码失败')
  return data.user
}

export async function toggleUserDisabled(id: number, disabled: boolean): Promise<User> {
  const { data } = await userHttp.put(`/auth/users/${id}`, { disabled })
  if (!data.succeed) throw new Error(data.error || '切换用户状态失败')
  return data.user
}

export async function deleteUser(id: number): Promise<void> {
  const { data } = await userHttp.delete(`/auth/users/${id}`)
  if (!data.succeed) throw new Error(data.error || '删除用户失败')
}
