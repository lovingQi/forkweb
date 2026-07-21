<template>
  <div class="ticket-list-page">
    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>工单列表</span>
          <el-button v-if="auth.isAfterSales" type="primary" @click="router.push('/tickets/new')">新建工单</el-button>
        </div>
      </template>
      <el-table v-loading="ticketStore.loading" :data="ticketStore.tickets" stripe>
        <el-table-column prop="ticketNo" label="工单号" width="160">
          <template #default="{ row }">
            <el-link type="primary" @click="router.push(`/tickets/${row.id}`)">{{ row.ticketNo }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="status" label="状态" width="140">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/tickets/${row.id}`)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useTicketStore } from '@/stores/tickets'
import type { TicketStatus } from '@/api/tickets'

const router = useRouter()
const auth = useAuthStore()
const ticketStore = useTicketStore()

onMounted(() => {
  ticketStore.loadTickets()
})

const statusMap: Record<TicketStatus, { label: string; type: any }> = {
  pending_analysis: { label: '待分析', type: 'info' },
  analyzing: { label: '分析中', type: 'warning' },
  analyzed: { label: '待验证', type: 'primary' },
  verifying: { label: '处理中', type: 'warning' },
  resolved: { label: '已解决', type: 'success' },
  needs_rd: { label: '需研发介入', type: 'danger' }
}

function statusLabel(status: TicketStatus) {
  return statusMap[status]?.label || status
}

function statusType(status: TicketStatus) {
  return statusMap[status]?.type || 'info'
}
</script>

<style scoped>
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
