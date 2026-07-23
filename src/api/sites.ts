import axios from 'axios'
import { config } from '@/config'

const siteHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 10000
})

siteHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
})

export interface Site {
  id: number
  name: string
  vehicleModelIds: number[]
  createdAt: string
  updatedAt: string
}

export interface CreateSiteInput {
  name: string
  vehicleModelIds?: number[]
}

export interface UpdateSiteInput {
  name: string
  vehicleModelIds?: number[]
}

export async function listSites(): Promise<Site[]> {
  const { data } = await siteHttp.get('/sites')
  if (!data.succeed) throw new Error(data.error || '获取现场列表失败')
  return data.sites
}

export async function createSite(input: CreateSiteInput): Promise<Site> {
  const { data } = await siteHttp.post('/sites', input)
  if (!data.succeed) throw new Error(data.error || '创建现场失败')
  return data.site
}

export async function updateSite(id: number, input: UpdateSiteInput): Promise<Site> {
  const { data } = await siteHttp.put(`/sites/${id}`, input)
  if (!data.succeed) throw new Error(data.error || '更新现场失败')
  return data.site
}

export async function deleteSite(id: number): Promise<void> {
  const { data } = await siteHttp.delete(`/sites/${id}`)
  if (!data.succeed) throw new Error(data.error || '删除现场失败')
}
