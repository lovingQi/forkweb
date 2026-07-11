<template>
  <div class="replay-charts">
    <button
      v-for="metric in metrics"
      :key="metric.key"
      class="chart"
      :title="metric.label"
      @click="emitPoint(metric)"
    >
      <span class="chart-label">{{ metric.label }}</span>
      <svg viewBox="0 0 240 52" preserveAspectRatio="none">
        <polyline :points="metric.points" fill="none" :stroke="metric.color" stroke-width="2" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ frames: any[]; errors: any[] }>()
const emit = defineEmits<{ (e: 'select-time', timeMs: number): void }>()

const metrics = computed(() => [
  buildMetric('score', '定位分', '#2563eb'),
  buildMetric('battery', '电量', '#16a34a'),
  buildMetric('speed', '速度', '#dc2626'),
  buildMetric('forkHeight', '货叉', '#9333ea'),
  buildErrorMetric()
])

function buildMetric(key: string, label: string, color: string) {
  const values = props.frames.map((frame) => {
    if (key === 'speed') return Math.hypot(Number(frame.vx || 0), Number(frame.vy || 0))
    return Number(frame[key] || 0)
  })
  return { key, label, color, points: pointsFor(values) }
}

function buildErrorMetric() {
  const values = props.frames.map((frame) =>
    props.errors.filter((error) => Math.abs(error.timeMs - frame.timeMs) <= 1000).length
  )
  return { key: 'errors', label: '错误', color: '#f59e0b', points: pointsFor(values) }
}

function pointsFor(values: number[]) {
  if (values.length === 0) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(1, max - min)
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 240
      const y = 48 - ((value - min) / span) * 42
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function emitPoint(metric: { key: string }) {
  if (props.frames.length === 0) return
  let best = props.frames[0]
  if (metric.key === 'errors') {
    const error = props.errors[0]
    if (error) emit('select-time', error.timeMs)
    return
  }
  for (const frame of props.frames) {
    if (Number(frame[metric.key] || 0) > Number(best[metric.key] || 0)) best = frame
  }
  emit('select-time', best.timeMs)
}
</script>

<style scoped>
.replay-charts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.chart {
  height: 76px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  text-align: left;
}
.chart-label {
  display: block;
  padding: 6px 8px 0;
  color: #374151;
  font-size: 12px;
  font-weight: 600;
}
.chart svg {
  width: 100%;
  height: 52px;
}
</style>
