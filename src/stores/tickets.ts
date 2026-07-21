import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  analyzeTicket as apiAnalyze,
  assignTicket as apiAssign,
  createKnowledgeFromTicket as apiCreateKnowledge,
  createTicket as apiCreate,
  getTicket as apiGet,
  listTickets as apiList,
  resolveTicket as apiResolve,
  verifyTicket as apiVerify,
  type Ticket,
  type TicketEvent
} from '@/api/tickets'

export const useTicketStore = defineStore('tickets', () => {
  const tickets = ref<Ticket[]>([])
  const currentTicket = ref<Ticket | null>(null)
  const currentEvents = ref<TicketEvent[]>([])
  const loading = ref(false)

  async function loadTickets(filters?: { status?: string; reporterId?: number; siteId?: number }) {
    loading.value = true
    try {
      tickets.value = await apiList(filters)
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

  async function createTicket(form: { title: string; description: string; siteId: number; logs: File; map?: File; aiEnabled?: boolean }) {
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
    loading,
    loadTickets,
    loadTicket,
    createTicket,
    analyzeTicket,
    verifyTicket,
    assignTicket,
    resolveTicket,
    createKnowledge
  }
})
