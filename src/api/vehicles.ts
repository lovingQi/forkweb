import axios from 'axios'
import { config } from '@/config'

const vehicleHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 10000
})

vehicleHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
})

export interface VehicleCategory {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface VehicleModel {
  id: number
  category_id: number
  name: string
  category_name: string
  created_at: string
  updated_at: string
}

export async function listCategories(): Promise<VehicleCategory[]> {
  const { data } = await vehicleHttp.get('/vehicles/categories')
  if (!data.succeed) throw new Error(data.error || '获取车型类别失败')
  return data.categories
}

export async function createCategory(name: string): Promise<VehicleCategory> {
  const { data } = await vehicleHttp.post('/vehicles/categories', { name })
  if (!data.succeed) throw new Error(data.error || '创建车型类别失败')
  return data.category
}

export async function updateCategory(id: number, name: string): Promise<VehicleCategory> {
  const { data } = await vehicleHttp.put(`/vehicles/categories/${id}`, { name })
  if (!data.succeed) throw new Error(data.error || '更新车型类别失败')
  return data.category
}

export async function deleteCategory(id: number): Promise<void> {
  const { data } = await vehicleHttp.delete(`/vehicles/categories/${id}`)
  if (!data.succeed) throw new Error(data.error || '删除车型类别失败')
}

export async function listModels(params?: { categoryId?: number; siteId?: number }): Promise<VehicleModel[]> {
  const { data } = await vehicleHttp.get('/vehicles/models', { params })
  if (!data.succeed) throw new Error(data.error || '获取车型型号失败')
  return data.models
}

export async function createModel(categoryId: number, name: string): Promise<VehicleModel> {
  const { data } = await vehicleHttp.post('/vehicles/models', { categoryId, name })
  if (!data.succeed) throw new Error(data.error || '创建车型型号失败')
  return data.model
}

export async function updateModel(id: number, name: string): Promise<VehicleModel> {
  const { data } = await vehicleHttp.put(`/vehicles/models/${id}`, { name })
  if (!data.succeed) throw new Error(data.error || '更新车型型号失败')
  return data.model
}

export async function deleteModel(id: number): Promise<void> {
  const { data } = await vehicleHttp.delete(`/vehicles/models/${id}`)
  if (!data.succeed) throw new Error(data.error || '删除车型型号失败')
}
