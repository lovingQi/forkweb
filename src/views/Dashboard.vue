<template>
  <div class="dashboard">
    <el-row :gutter="16" class="dash-row">
      <el-col :span="17">
        <el-card shadow="never" class="canvas-card" body-class="canvas-card-body">
          <CanvasView :show-map="true" />
        </el-card>
      </el-col>
      <el-col :span="7">
        <el-card shadow="never" class="status-card">
          <StatusPanel />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import CanvasView from '@/components/CanvasView.vue'
import StatusPanel from '@/components/StatusPanel.vue'
</script>

<style scoped>
.dashboard,
.dash-row {
  height: 100%;
  min-height: 0;
}
.dash-row :deep(.el-col) {
  height: 100%;
  min-height: 0;
}
.canvas-card {
  height: 100%;
  min-height: 0;
}
:deep(.canvas-card-body) {
  height: calc(100% - 0px);
  padding: 8px;
}
.canvas-card :deep(.el-card__body) {
  height: 100%;
  padding: 8px;
}
.status-card {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.status-card :deep(.el-card__body) {
  height: 100%;
  overflow-y: auto;
}
</style>
