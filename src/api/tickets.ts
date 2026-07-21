import axios from 'axios'
import { config } from '@/config'

const ticketHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 60000
})

ticketHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
})

export type TicketStatus =
  | 'pending_analysis'
  | 'analyzing'
  | 'analyzed'
  | 'verifying'
  | 'resolved'
  | 'needs_rd'

export interface Ticket {
  id: number
  ticketNo: string
  title: string
  description: string
  reporterId: number
  assigneeId: number | null
  status: TicketStatus
  conclusion: string | null
  reportPath: string | null
  packagePath: string | null
  logDir: string
  mapDir: string | null
  mapFile: string | null
  aiEnabled: boolean
  aiConclusion: string | null
  aiOffline: boolean
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface TicketEvent {
  id: number
  action: string
  payload: Record<string, any> | null
  createdAt: string
}

export async function createTicket(form: {
  title: string
  description: string
  logs: File
  map?: File
  aiEnabled?: boolean
}): Promise<Ticket> {
  const data = new FormData()
  data.append('title', form.title)
  data.append('description', form.description)
  data.append('logs', form.logs)
  if (form.map) data.append('map', form.map)
  data.append('aiEnabled', form.aiEnabled ? 'true' : 'false')
  const { data: res } = await ticketHttp.post('/tickets', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  if (!res.succeed) throw new Error(res.error || '创建工单失败')
  return res.ticket
}

export async function listTickets(): Promise<Ticket[]> {
  const { data } = await ticketHttp.get('/tickets')
  if (!data.succeed) throw new Error(data.error || '获取工单失败')
  return data.tickets
}

export async function getTicket(id: number): Promise<{ ticket: Ticket; events: TicketEvent[] }> {
  const { data } = await ticketHttp.get(`/tickets/${id}`)
  if (!data.succeed) throw new Error(data.error || '获取工单详情失败')
  return { ticket: data.ticket, events: data.events }
}

export async function analyzeTicket(id: number): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/analyze`)
  if (!data.succeed) throw new Error(data.error || '触发分析失败')
  return data.ticket
}

export async function verifyTicket(id: number, result: 'resolved' | 'needs_rd'): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/verify`, { result })
  if (!data.succeed) throw new Error(data.error || '提交验证结果失败')
  return data.ticket
}

export async function assignTicket(id: number): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/assign`)
  if (!data.succeed) throw new Error(data.error || '认领工单失败')
  return data.ticket
}

export async function resolveTicket(id: number, solution: string): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/resolve`, { solution })
  if (!data.succeed) throw new Error(data.error || '标记解决失败')
  return data.ticket
}

export async function getTicketReport(id: number): Promise<string> {
  const { data } = await ticketHttp.get(`/tickets/${id}/report`, { responseType: 'text' })
  return data
}

export async function createKnowledgeFromTicket(
  id: number,
  input: {
    title: string
    description: string
    rootCause: string
    solution: string
    keywords?: string[]
    modules?: string[]
    errorCodes?: string[]
  }
): Promise<{ id: string; title: string }> {
  const { data } = await ticketHttp.post(`/tickets/${id}/knowledge`, input)
  if (!data.succeed) throw new Error(data.error || '沉淀知识库失败')
  return data.rule
}
