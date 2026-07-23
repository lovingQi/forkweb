import axios from 'axios'
import { config } from '@/config'

const statsHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 60000
})

statsHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
})

export interface DateRangeQuery {
  startDate?: string
  endDate?: string
}

export interface StatusDistributionItem {
  status: string
  count: number
}

export interface TicketStats {
  totalTickets: number
  statusDistribution: StatusDistributionItem[]
  selfServiceRate: number
  selfServiceRateText: string
  avgResolutionSeconds: number
  avgResolutionText: string
  bySite: { siteId: number | null; siteName: string; count: number }[]
  byIssueType: { issueType: string; count: number }[]
  byVehicleModel: { vehicleModelId: number | null; vehicleModelName: string; vehicleCategoryName: string; count: number }[]
}

export interface KnowledgeStats {
  totalRules: number
  verifiedRules: number
  coverageRate: number
  coverageRateText: string
  topRules: { id: string; title: string; hitCount: number; enabled: boolean }[]
  feedbackDistribution: { useful: number; partial: number; useless: number }
}

export interface UserStats {
  afterSalesRanking: { userId: number; username: string; displayName: string | null; count: number }[]
  rdResolutionRanking: { userId: number; username: string; displayName: string | null; count: number }[]
}

export async function fetchStatsTickets(range?: DateRangeQuery): Promise<TicketStats> {
  const params = new URLSearchParams()
  if (range?.startDate) params.append('startDate', range.startDate)
  if (range?.endDate) params.append('endDate', range.endDate)
  const { data } = await statsHttp.get(`/stats/tickets?${params.toString()}`)
  if (!data.succeed) throw new Error(data.error || '加载工单统计失败')
  return data.stats
}

export async function fetchStatsKnowledge(): Promise<KnowledgeStats> {
  const { data } = await statsHttp.get('/stats/knowledge')
  if (!data.succeed) throw new Error(data.error || '加载知识库统计失败')
  return data.stats
}

export async function fetchStatsUsers(range?: DateRangeQuery): Promise<UserStats> {
  const params = new URLSearchParams()
  if (range?.startDate) params.append('startDate', range.startDate)
  if (range?.endDate) params.append('endDate', range.endDate)
  const { data } = await statsHttp.get(`/stats/users?${params.toString()}`)
  if (!data.succeed) throw new Error(data.error || '加载人员统计失败')
  return data.stats
}
