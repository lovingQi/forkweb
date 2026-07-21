<template>
  <div class="ticket-list-page">
    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>工单列表</span>
          <el-button v-if="auth.isAfterSales" type="primary" @click="router.push('/tickets/new')">新建工单</el-button>
        </div>
      </template>

      <div class="filter-row">
        <el-select v-model="filterStatus" clearable placeholder="全部状态" style="width: 160px" @change="onFilterChange">
          <el-option label="全部状态" value="" />
          <el-option v-for="(item, key) in statusMap" :key="key" :label="item.label" :value="key" />
        </el-select>
        <el-select
          v-if="auth.isRd"
          v-model="filterReporter"
          clearable
          placeholder="全部提单人"
          style="width: 180px; margin-left: 12px"
          @change="onFilterChange"
        >
          <el-option label="全部提单人" value="" />
          <el-option v-for="u in users" :key="u.id" :label="u.displayName || u.username" :value="u.id" />
        </el-select>
      </div>

      <el-table v-loading="ticketStore.loading" :data="ticketStore.tickets" stripe>
        <el-table-column prop="ticketNo" label="工单号" width="160">
          <template #default="{ row }">
            <el-link type="primary" @click="router.push(`/tickets/${row.id}`)">{{ row.ticketNo }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="siteName" label="项目现场" width="160">
          <template #default="{ row }">
            {{ row.siteName || '-' }}
          </template>
        </el-table-column>
        <el-table-column v-if="auth.isRd" prop="reporterName" label="提单人" width="140" />
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
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useTicketStore } from '@/stores/tickets'
import { listUsers, type User } from '@/api/users'
import type { TicketStatus } from '@/api/tickets'

const router = useRouter()
const auth = useAuthStore()
const ticketStore = useTicketStore()

const filterStatus = ref('')
const filterReporter = ref('')
const users = ref<User[]>([])

onMounted(async () => {
  if (auth.isRd) {
    try {
      users.value = await listUsers()
    } catch (e) {
      console.error('加载用户列表失败', e)
    }
  }
  loadTickets()
})

function loadTickets() {
  const filters: { status?: string; reporterId?: number } = {}
  if (filterStatus.value) filters.status = filterStatus.value
  if (filterReporter.value) filters.reporterId = Number(filterReporter.value)
  ticketStore.loadTickets(filters)
}

function onFilterChange() {
  loadTickets()
}

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
.filter-row {
  margin-bottom: 16px;
}
</style>
