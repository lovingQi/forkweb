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
  createdAt: string
}

export interface CreateUserInput {
  username: string
  password: string
  role: 'after_sales' | 'rd' | 'admin'
  displayName?: string
  email?: string
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
