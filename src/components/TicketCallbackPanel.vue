<template>
  <div class="callback-panel">
    <el-table v-loading="loading" :data="callbacks" empty-text="暂无回调记录" size="small">
      <el-table-column prop="eventType" label="事件类型" min-width="160" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">{{ statusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column prop="attemptCount" label="发送次数" width="90" />
      <el-table-column label="最近 HTTP 状态码" width="140">
        <template #default="{ row }">{{ row.lastHttpStatus ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="最近错误" min-width="180">
        <template #default="{ row }">{{ row.lastError || '-' }}</template>
      </el-table-column>
      <el-table-column prop="nextAttemptAt" label="下次发送时间" min-width="180" />
      <el-table-column prop="createdAt" label="创建时间" min-width="180" />
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'pending' || row.status === 'failed'"
            link
            type="primary"
            :loading="retryingId === row.id"
            @click="onRetry(row.id)"
          >重推</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { listTicketCallbacks, retryTicketCallback, type CallbackDelivery } from '@/api/tickets'

const props = defineProps<{ ticketId: number }>()

const loading = ref(false)
const retryingId = ref<number | null>(null)
const callbacks = ref<CallbackDelivery[]>([])

function statusLabel(status: CallbackDelivery['status']): string {
  if (status === 'pending') return '待发送'
  if (status === 'succeeded') return '已送达'
  return '已放弃'
}

async function loadCallbacks() {
  loading.value = true
  try {
    callbacks.value = await listTicketCallbacks(props.ticketId)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '获取回调记录失败')
  } finally {
    loading.value = false
  }
}

async function onRetry(deliveryId: number) {
  retryingId.value = deliveryId
  try {
    await retryTicketCallback(props.ticketId, deliveryId)
    ElMessage.success('已重新加入发送队列')
    await loadCallbacks()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '重推回调失败')
  } finally {
    retryingId.value = null
  }
}

onMounted(() => {
  void loadCallbacks()
})
</script>
