import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  addTicketComment as apiAddTicketComment,
  analyzeTicket as apiAnalyze,
  appendFiles as apiAppendFiles,
  assignTicket as apiAssign,
  cancelTicket as apiCancel,
  createKnowledgeFromTicket as apiCreateKnowledge,
  createTicket as apiCreate,
  deleteTicket as apiDeleteTicket,
  escalateToRd as apiEscalate,
  getAnalysisVersion as apiGetAnalysisVersion,
  getKnowledgeSuggestions as apiGetKnowledgeSuggestions,
  getTicket as apiGet,
  listAnalysisVersions as apiListAnalysisVersions,
  listTickets as apiList,
  listTroubleshootingPaths as apiListTroubleshootingPaths,
  recordStepStatus as apiRecordStepStatus,
  resolveSelfService as apiResolveSelfService,
  resolveTicket as apiResolve,
  startFieldTroubleshooting as apiStartFieldTroubleshooting,
  switchAnalysisVersion as apiSwitchAnalysisVersion,
  updateIssueType as apiUpdateIssueType,
  updateTicketBasicInfo as apiUpdateTicketBasicInfo,
  verifyTicket as apiVerify,
  type AnalysisVersion,
  type IssueType,
  type Ticket,
  type TicketEvent,
  type TroubleshootingPath
} from '@/api/tickets'

export const useTicketStore = defineStore('tickets', () => {
  const tickets = ref<Ticket[]>([])
  const currentTicket = ref<Ticket | null>(null)
  const currentEvents = ref<TicketEvent[]>([])
  const analysisVersions = ref<AnalysisVersion[]>([])
  const currentAnalysisVersion = ref<AnalysisVersion | null>(null)
  const troubleshootingPaths = ref<TroubleshootingPath[]>([])
  const loading = ref(false)
  const total = ref(0)

  async function loadTickets(filters?: {
    status?: string
    reporterId?: number
    siteId?: number
    vehicleModelId?: number
    page?: number
    pageSize?: number
  }) {
    loading.value = true
    try {
      const res = await apiList({
        ...filters,
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 20
      })
      tickets.value = res.tickets
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function loadTicket(id: number) {
    loading.value = true
    try {
      const res = await apiGet(id)
      currentTicket.value = res.ticket
      currentEvents.value = res.events
    } finally {
      loading.value = false
    }
  }

  async function createTicket(form: {
    title: string
    description: string
    siteId: number
    vehicleModelId?: number
    issueType?: string
    impactLevel?: string
    occurredStartAt?: string
    occurredEndAt?: string
    tempFileIds?: string[]
    files?: File[]
    aiEnabled?: boolean
  }) {
    const ticket = await apiCreate(form)
    tickets.value.unshift(ticket)
    return ticket
  }

  async function analyzeTicket(id: number) {
    const ticket = await apiAnalyze(id)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === id) currentTicket.value = ticket
    return ticket
  }

  async function verifyTicket(id: number, result: 'resolved' | 'needs_rd') {
    const ticket = await apiVerify(id, result)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === id) currentTicket.value = ticket
    return ticket
  }

  async function resolveSelfService(
    id: number,
    input: { result: string; guideFeedback: string; note?: string }
  ) {
    const ticket = await apiResolveSelfService(id, input)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === id) currentTicket.value = ticket
    return ticket
  }

  async function escalateToRd(id: number, reason: string) {
    const ticket = await apiEscalate(id, reason)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === id) currentTicket.value = ticket
    return ticket
  }

  async function assignTicket(id: number) {
    const ticket = await apiAssign(id)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === id) currentTicket.value = ticket
    return ticket
  }

  async function resolveTicket(id: number, solution: string) {
    const ticket = await apiResolve(id, solution)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === id) currentTicket.value = ticket
    return ticket
  }

  async function createKnowledge(
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
  ) {
    return apiCreateKnowledge(id, input)
  }

  async function getKnowledgeSuggestions(id: number) {
    return apiGetKnowledgeSuggestions(id)
  }

  async function loadAnalysisVersions(ticketId: number) {
    analysisVersions.value = await apiListAnalysisVersions(ticketId)
    const ticket = currentTicket.value
    if (ticket && ticket.id === ticketId) {
      const latest = analysisVersions.value.find((v) => v.id === ticket.latestAnalysisVersionId)
        || analysisVersions.value[0]
      currentAnalysisVersion.value = latest || null
    }
  }

  async function loadAnalysisVersion(ticketId: number, versionId: number) {
    const version = await apiGetAnalysisVersion(ticketId, versionId)
    const idx = analysisVersions.value.findIndex((v) => v.id === versionId)
    if (idx >= 0) {
      analysisVersions.value[idx] = version
    }
    if (currentTicket.value?.id === ticketId) {
      currentAnalysisVersion.value = version
    }
    return version
  }

  async function loadTroubleshootingPaths(ticketId: number, analysisVersionId?: number) {
    troubleshootingPaths.value = await apiListTroubleshootingPaths(ticketId, analysisVersionId)
  }

  async function startFieldTroubleshooting(ticketId: number) {
    const ticket = await apiStartFieldTroubleshooting(ticketId)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === ticketId) {
      currentTicket.value = ticket
    }
    return ticket
  }

  async function recordStepStatus(
    ticketId: number,
    pathId: number,
    stepId: number,
    input: { status: string; reason?: string; analysisVersionId?: number }
  ) {
    await apiRecordStepStatus(ticketId, pathId, stepId, input)
    // Reload events after recording step status
    await loadTicket(ticketId)
  }

  async function switchAnalysisVersion(ticketId: number, versionId: number) {
    const { ticket, version } = await apiSwitchAnalysisVersion(ticketId, versionId)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === ticketId) {
      currentTicket.value = ticket
      currentAnalysisVersion.value = version
      await loadTroubleshootingPaths(ticketId, version.id)
    }
    return { ticket, version }
  }

  async function updateIssueType(ticketId: number, issueType: IssueType) {
    const ticket = await apiUpdateIssueType(ticketId, issueType)
    updateTicketInList(ticket)
    if (currentTicket.value?.id === ticketId) {
      currentTicket.value = ticket
    }
    return ticket
  }

  async function cancelTicket(id: number) {
    const ticket = await apiCancel(id)
    updateTicketInList(ticket)
    await loadTicket(id)
    return ticket
  }

  async function deleteTicket(id: number) {
    await apiDeleteTicket(id)
    const idx = tickets.value.findIndex((t) => t.id === id)
    if (idx >= 0) {
      tickets.value.splice(idx, 1)
    }
    if (currentTicket.value?.id === id) {
      currentTicket.value = null
      currentEvents.value = []
    }
  }

  async function updateTicketBasicInfo(id: number, input: Parameters<typeof apiUpdateTicketBasicInfo>[1]) {
    const ticket = await apiUpdateTicketBasicInfo(id, input)
    updateTicketInList(ticket)
    await loadTicket(id)
    return ticket
  }

  async function addTicketComment(id: number, content: string) {
    await apiAddTicketComment(id, content)
    await loadTicket(id)
  }

  async function appendFiles(id: number, files: File[], reanalyze?: boolean) {
    const ticket = await apiAppendFiles(id, files, reanalyze)
    updateTicketInList(ticket)
    await loadTicket(id)
    return ticket
  }

  function updateTicketInList(ticket: Ticket) {
    const idx = tickets.value.findIndex((t) => t.id === ticket.id)
    if (idx >= 0) {
      tickets.value[idx] = ticket
    } else {
      tickets.value.unshift(ticket)
    }
  }

  return {
    tickets,
    currentTicket,
    currentEvents,
    analysisVersions,
    currentAnalysisVersion,
    troubleshootingPaths,
    loading,
    total,
    loadTickets,
    loadTicket,
    createTicket,
    analyzeTicket,
    verifyTicket,
    resolveSelfService,
    escalateToRd,
    assignTicket,
    resolveTicket,
    createKnowledge,
    getKnowledgeSuggestions,
    loadAnalysisVersions,
    loadAnalysisVersion,
    loadTroubleshootingPaths,
    startFieldTroubleshooting,
    recordStepStatus,
    switchAnalysisVersion,
    updateIssueType,
    cancelTicket,
    deleteTicket,
    updateTicketBasicInfo,
    addTicketComment,
    appendFiles
  }
})
