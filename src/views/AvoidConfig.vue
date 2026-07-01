<template>
  <div class="avoid-config">
    <el-row :gutter="16" class="row">
      <el-col :span="13">
        <el-card shadow="never" class="form-card">
          <template #header>
            <div class="card-header">
              <span>避障参数</span>
              <el-button size="small" @click="reload">刷新</el-button>
            </div>
          </template>
          <el-alert
            type="warning"
            :closable="false"
            title="安全提示：车辆运动中将拒绝修改避障参数，请在停止/空闲状态下操作。"
            class="mb"
          />
          <ParamForm v-if="avoidSection" :section="avoidSection" :fields="store.paramsInfo[avoidSection]" @saved="reload" />
          <el-empty v-else description="未获取到避障参数（请检查后端 /api/params）" />
        </el-card>
      </el-col>
      <el-col :span="11">
        <el-card shadow="never" class="preview-card">
          <template #header>避障范围实时预览</template>
          <div class="preview-canvas">
            <CanvasView :show-map="false" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRobotStore } from '@/stores/robot'
import ParamForm from '@/components/ParamForm.vue'
import CanvasView from '@/components/CanvasView.vue'

const store = useRobotStore()

const avoidSection = computed(() => {
  const keys = Object.keys(store.paramsInfo)
  if (keys.includes('avoid')) return 'avoid'
  return keys.find((k) => k.toLowerCase().includes('avoid')) || ''
})

async function reload() {
  await store.reloadParams()
}

onMounted(() => {
  if (Object.keys(store.paramsInfo).length === 0) {
    store.reloadParams()
  }
})
</script>

<style scoped>
.avoid-config,
.row {
  height: 100%;
  min-height: 0;
}
.row :deep(.el-col) {
  height: 100%;
  min-height: 0;
}
.form-card {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}
.preview-card {
  height: 100%;
  min-height: 0;
}
.preview-card :deep(.el-card__body) {
  height: calc(100% - 56px);
}
.preview-canvas {
  height: 100%;
  min-height: 360px;
}
.mb {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
