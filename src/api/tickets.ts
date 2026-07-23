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
  | 'pending_field_troubleshooting'
  | 'field_troubleshooting'
  | 'self_solved'
  | 'pending_rd'
  | 'rd_working'
  | 'resolved'
  | 'cancelled'

export interface AnalysisVersion {
  id: number
  ticketId: number
  versionNo: number
  inputLogDir: string
  inputMapDir?: string
  inputMapFile?: string
  inputPackageSource?: string
  occurredStartAt?: string
  occurredEndAt?: string
  issueType?: string
  topIssues: any[]
  troubleshootingPathsSnapshot?: any
  evidenceSummary?: any
  reportPath?: string
  packagePath?: string
  createdAt: string
}

export interface Ticket {
  id: number
  ticketNo: string
  title: string
  description: string
  reporterId: number
  reporterName?: string
  siteId?: number
  siteName?: string
  vehicleModelId?: number
  vehicleModelName?: string
  vehicleCategoryName?: string
  assigneeId: number | null
  status: TicketStatus
  issueType?: string
  impactLevel?: string
  occurredStartAt?: string
  occurredEndAt?: string
  selfServiceResult?: string
  selfServiceNote?: string
  escalationReason?: string
  guideFeedback?: string
  conclusion: string | null
  reportPath: string | null
  packagePath: string | null
  logDir: string
  mapDir: string | null
  mapFile: string | null
  aiEnabled: boolean
  aiConclusion: string | null
  aiOffline: boolean
  latestAnalysisVersionId?: number
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

export interface TempFileInfo {
  tempFileId: string
  originalName: string
  size: number
}

export async function uploadTicketFiles(
  files: File[],
  onProgress?: (percent: number) => void
): Promise<TempFileInfo[]> {
  const data = new FormData()
  for (const file of files) {
    data.append('files', file)
  }
  const { data: res } = await ticketHttp.post('/tickets/upload-files', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
    onUploadProgress: (progressEvent) => {
      if (!onProgress || !progressEvent.total) return
      const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
      onProgress(percent)
    }
  })
  if (!res.succeed) throw new Error(res.error || '文件预上传失败')
  return res.files as TempFileInfo[]
}

export async function createTicket(form: {
  title: string
  description: string
  siteId: number
  vehicleModelId?: number
  issueType?: string
  impactLevel?: string
  occurredStartAt?: string
  occurredEndAt?: string
  tempFileIds?: string[]
  aiEnabled?: boolean
}): Promise<Ticket> {
  const body: Record<string, any> = {
    title: form.title,
    description: form.description,
    siteId: form.siteId,
    aiEnabled: form.aiEnabled ? 'true' : 'false'
  }
  if (form.vehicleModelId) body.vehicleModelId = form.vehicleModelId
  if (form.issueType) body.issueType = form.issueType
  if (form.impactLevel) body.impactLevel = form.impactLevel
  if (form.occurredStartAt) body.occurredStartAt = form.occurredStartAt
  if (form.occurredEndAt) body.occurredEndAt = form.occurredEndAt
  if (form.tempFileIds && form.tempFileIds.length > 0) {
    body.tempFileIds = form.tempFileIds
  }

  const { data: res } = await ticketHttp.post('/tickets', body)
  if (!res.succeed) throw new Error(res.error || '创建工单失败')
  return res.ticket
}

export interface ListTicketsFilters {
  status?: string
  reporterId?: number
  siteId?: number
  issueType?: string
  vehicleModelId?: number
  page?: number
  pageSize?: number
}

export async function listTickets(filters?: ListTicketsFilters): Promise<{ tickets: Ticket[]; total: number }> {
  const params: Record<string, string> = {}
  if (filters?.status) params.status = filters.status
  if (filters?.reporterId !== undefined) params.reporterId = String(filters.reporterId)
  if (filters?.siteId !== undefined) params.siteId = String(filters.siteId)
  if (filters?.issueType) params.issueType = filters.issueType
  if (filters?.vehicleModelId !== undefined) params.vehicleModelId = String(filters.vehicleModelId)
  if (filters?.page !== undefined) params.page = String(filters.page)
  if (filters?.pageSize !== undefined) params.pageSize = String(filters.pageSize)
  const { data } = await ticketHttp.get('/tickets', { params })
  if (!data.succeed) throw new Error(data.error || '获取工单失败')
  return { tickets: data.tickets, total: data.total }
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

export async function resolveSelfService(
  id: number,
  input: { result: string; guideFeedback: string; note?: string }
): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/resolve-self-service`, input)
  if (!data.succeed) throw new Error(data.error || '提交自助解决结果失败')
  return data.ticket
}

export async function escalateToRd(id: number, reason: string): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/escalate-to-rd`, { reason })
  if (!data.succeed) throw new Error(data.error || '升级研发失败')
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

export interface KnowledgeSuggestion {
  title?: string
  description?: string
  rootCause?: string
  solution?: string
  keywords?: string[]
  modules?: string[]
  errorCodes?: string[]
}

export async function getKnowledgeSuggestions(id: number): Promise<KnowledgeSuggestion> {
  const { data } = await ticketHttp.get(`/tickets/${id}/knowledge-suggestions`)
  if (!data.succeed) throw new Error(data.error || '获取 AI 预填建议失败')
  return data.suggestion
}

export type IssueType =
  | 'positioning'
  | 'laser'
  | 'obstacle_avoidance'
  | 'map'
  | 'task_failure'
  | 'charging'
  | 'hardware_communication'
  | 'fork_sensor'
  | 'unknown'

export interface TroubleshootingStep {
  id: number
  stepNo: number
  title: string
  instruction?: string
  criteria?: string
  stepType: 'readonly_check' | 'field_operation' | 'rd_required'
  estimatedTime?: string
  evidenceConfig?: any
  isCritical: boolean
  failureAction?: string
  status: 'unchecked' | 'passed' | 'failed' | 'not_applicable'
  statusUpdatedAt?: string
  notApplicableReason?: string
}

export interface TroubleshootingPath {
  id: number
  analysisVersionId: number
  ruleId: string
  title: string
  priority: number
  confidence: number
  severity: 'info' | 'warning' | 'error'
  status: string
  steps: TroubleshootingStep[]
}

export async function listTroubleshootingPaths(
  ticketId: number,
  analysisVersionId?: number
): Promise<TroubleshootingPath[]> {
  const params: Record<string, string> = {}
  if (analysisVersionId !== undefined) params.analysisVersionId = String(analysisVersionId)
  const { data } = await ticketHttp.get(`/tickets/${ticketId}/troubleshooting-paths`, { params })
  if (!data.succeed) throw new Error(data.error || '获取排查路径失败')
  return data.paths
}

export async function startFieldTroubleshooting(ticketId: number): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${ticketId}/start-troubleshooting`)
  if (!data.succeed) throw new Error(data.error || '开始排查失败')
  return data.ticket
}

export async function recordStepStatus(
  ticketId: number,
  pathId: number,
  stepId: number,
  input: { status: string; reason?: string; analysisVersionId?: number }
): Promise<void> {
  const { data } = await ticketHttp.post(`/tickets/${ticketId}/paths/${pathId}/steps/${stepId}/status`, input)
  if (!data.succeed) throw new Error(data.error || '记录步骤状态失败')
}

export async function updateIssueType(id: number, issueType: IssueType): Promise<Ticket> {
  const { data } = await ticketHttp.patch(`/tickets/${id}/issue-type`, { issueType })
  if (!data.succeed) throw new Error(data.error || '更新问题类型失败')
  return data.ticket
}

export interface UpdateTicketBasicInfoInput {
  title?: string
  description?: string
  siteId?: number
  vehicleModelId?: number
  impactLevel?: string
  occurredStartAt?: string
  occurredEndAt?: string
}

export async function cancelTicket(id: number): Promise<Ticket> {
  const { data } = await ticketHttp.post(`/tickets/${id}/cancel`)
  if (!data.succeed) throw new Error(data.error || '取消工单失败')
  return data.ticket
}

export async function deleteTicket(id: number): Promise<void> {
  const { data } = await ticketHttp.delete(`/tickets/${id}`)
  if (!data.succeed) throw new Error(data.error || '删除工单失败')
}

export async function updateTicketBasicInfo(id: number, input: UpdateTicketBasicInfoInput): Promise<Ticket> {
  const { data } = await ticketHttp.patch(`/tickets/${id}/basic-info`, input)
  if (!data.succeed) throw new Error(data.error || '更新基本信息失败')
  return data.ticket
}

export async function addTicketComment(id: number, content: string): Promise<void> {
  const { data } = await ticketHttp.post(`/tickets/${id}/comments`, { content })
  if (!data.succeed) throw new Error(data.error || '发表评论失败')
}

export async function appendFiles(id: number, files: File[], reanalyze?: boolean): Promise<Ticket> {
  const data = new FormData()
  for (const file of files) {
    data.append('files', file)
  }
  data.append('reanalyze', reanalyze ? 'true' : 'false')
  const { data: res } = await ticketHttp.post(`/tickets/${id}/files`, data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  if (!res.succeed) throw new Error(res.error || '补充上传失败')
  return res.ticket
}

export async function listAnalysisVersions(ticketId: number): Promise<AnalysisVersion[]> {
  const { data } = await ticketHttp.get(`/tickets/${ticketId}/analysis-versions`)
  if (!data.succeed) throw new Error(data.error || '获取分析版本失败')
  return data.versions
}

export async function getAnalysisVersion(ticketId: number, versionId: number): Promise<AnalysisVersion> {
  const { data } = await ticketHttp.get(`/tickets/${ticketId}/analysis-versions/${versionId}`)
  if (!data.succeed) throw new Error(data.error || '获取分析版本详情失败')
  return data.version
}

export async function switchAnalysisVersion(
  ticketId: number,
  versionId: number
): Promise<{ ticket: Ticket; version: AnalysisVersion }> {
  const { data } = await ticketHttp.post(`/tickets/${ticketId}/analysis-versions/${versionId}/switch`)
  if (!data.succeed) throw new Error(data.error || '切换分析版本失败')
  return { ticket: data.ticket, version: data.version }
}
