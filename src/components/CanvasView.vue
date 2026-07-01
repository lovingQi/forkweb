<template>
  <div ref="wrap" class="canvas-wrap">
    <canvas ref="cv" class="canvas-el"></canvas>
    <div class="canvas-toolbar">
      <el-button size="small" @click="recenter">回中</el-button>
      <el-button size="small" @click="zoom(1.2)">放大</el-button>
      <el-button size="small" @click="zoom(1 / 1.2)">缩小</el-button>
      <el-tag size="small" type="info">{{ (scale * 1000).toFixed(1) }} px/m</el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRobotStore, type Point } from '@/stores/robot'

const props = withDefaults(defineProps<{ showMap?: boolean }>(), { showMap: true })

const store = useRobotStore()

const wrap = ref<HTMLDivElement | null>(null)
const cv = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let ro: ResizeObserver | null = null

// 视图状态：scale 为 px/mm，pan 为附加在跟随中心上的世界偏移(mm)
const scale = ref(0.05)
let panX = 0
let panY = 0
let follow = true
// 用户是否已手动交互(交互后不再自动套用初始视图)
let userInteracted = false

let dragging = false
let lastX = 0
let lastY = 0

// 地图离屏缓存(障碍点云预渲染到世界尺度的离屏画布，绘制时整体缩放 blit)
let mapCanvas: HTMLCanvasElement | null = null
let mapMeta: { minX: number; maxY: number; res: number; w: number; h: number } | null = null
interface Goal {
  name: string
  x: number
  y: number
}
let mapGoals: Goal[] = []
let mapPathPts: Record<string, Point> = {}
let mapPathEdges: Array<[Point, Point]> = []

function parsePoseStr(s?: string): Point {
  if (!s) return { x: 0, y: 0 }
  const p = s.trim().split(/\s+/).map((v) => parseFloat(v))
  return { x: p[0] || 0, y: p[1] || 0 }
}

function buildMapCache() {
  mapCanvas = null
  mapMeta = null
  mapGoals = []
  mapPathPts = {}
  mapPathEdges = []
  const data = store.map.data
  if (!data) return

  const minP = String(data.MinPose || '0 0').trim().split(/\s+/).map((v: string) => parseFloat(v))
  const maxP = String(data.MaxPose || '0 0').trim().split(/\s+/).map((v: string) => parseFloat(v))
  const res = Math.max(1, Number(data.MapRes) || 20)
  const minX = minP[0]
  const minY = minP[1]
  const maxX = maxP[0]
  const maxY = maxP[1]
  const w = Math.max(1, Math.ceil((maxX - minX) / res))
  const h = Math.max(1, Math.ceil((maxY - minY) / res))

  if (Array.isArray(data.ObsPoints) && w * h <= 64_000_000) {
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const octx = off.getContext('2d')
    if (octx) {
      octx.fillStyle = '#9aa7b8'
      // ObsPoints 每行为 [x, y1, y2, ...]
      for (const row of data.ObsPoints) {
        if (!Array.isArray(row) || row.length < 2) continue
        const x = row[0]
        const px = Math.round((x - minX) / res)
        for (let i = 1; i < row.length; i++) {
          const py = Math.round((maxY - row[i]) / res)
          if (px >= 0 && px < w && py >= 0 && py < h) octx.fillRect(px, py, 1, 1)
        }
      }
      mapCanvas = off
      mapMeta = { minX, maxY, res, w, h }
    }
  }

  // 目标点与路径点图
  const objs = data.Objs || {}
  if (Array.isArray(objs.GoalWithHeading)) {
    mapGoals = objs.GoalWithHeading.map((g: any) => {
      const p = parsePoseStr(g.pose)
      return { name: g.name || '', x: p.x, y: p.y }
    })
  }
  if (Array.isArray(objs.PathPoint)) {
    for (const pp of objs.PathPoint) {
      if (pp && pp.name) mapPathPts[pp.name] = parsePoseStr(pp.pose)
    }
    for (const pp of objs.PathPoint) {
      if (!pp || !pp.name || !pp.vertex) continue
      const a = mapPathPts[pp.name]
      const neighbors = String(pp.vertex).trim().split(/\s+/)
      for (const nb of neighbors) {
        const b = mapPathPts[nb]
        if (a && b) mapPathEdges.push([a, b])
      }
    }
  }

  // 地图首次就绪且用户尚未手动交互时，套用初始视图(整图自适应)
  if (!userInteracted) initialView()
}

watch(
  () => store.map.data,
  () => buildMapCache(),
  { deep: false }
)

function centerWorld(): Point {
  if (follow) {
    return { x: store.pose[0] + panX, y: store.pose[1] + panY }
  }
  return { x: panX, y: panY }
}

function worldToScreen(p: Point): Point {
  const c = cv.value!
  const cw = centerWorld()
  return {
    x: c.width / 2 + (p.x - cw.x) * scale.value,
    y: c.height / 2 - (p.y - cw.y) * scale.value
  }
}

// 以机器人当前位置为中心(跟随)，缩放保持不变
function recenter() {
  userInteracted = true
  follow = true
  panX = 0
  panY = 0
}

function zoom(factor: number) {
  userInteracted = true
  scale.value = Math.min(2, Math.max(0.001, scale.value * factor))
}

// 初始视图：优先整张地图自适应；无地图则以机器人为中心用合适缩放
function fitToMap(): boolean {
  if (!mapMeta || !cv.value) return false
  const c = cv.value
  const worldW = mapMeta.w * mapMeta.res
  const worldH = mapMeta.h * mapMeta.res
  if (worldW <= 0 || worldH <= 0 || c.width === 0 || c.height === 0) return false
  const margin = 0.92
  const s = Math.min((c.width * margin) / worldW, (c.height * margin) / worldH)
  scale.value = Math.min(2, Math.max(0.0005, s))
  follow = false
  panX = mapMeta.minX + worldW / 2
  panY = mapMeta.maxY - worldH / 2
  return true
}

function initialView() {
  if (fitToMap()) return
  follow = true
  panX = 0
  panY = 0
  if (cv.value && cv.value.width > 0) {
    // 无地图时默认约 25m 视野，机器人居中
    scale.value = Math.min(2, Math.max(0.005, cv.value.width / 25000))
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)
}

function onDown(e: MouseEvent) {
  userInteracted = true
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}

function onMove(e: MouseEvent) {
  if (!dragging) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  if (follow) {
    // 拖动即脱离跟随，固定到当前中心
    const c = centerWorld()
    follow = false
    panX = c.x
    panY = c.y
  }
  panX -= dx / scale.value
  panY += dy / scale.value
}

function onUp() {
  dragging = false
}

function drawGrid() {
  const c = cv.value!
  if (!ctx) return
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.strokeStyle = 'rgba(148,163,184,0.12)'
  ctx.lineWidth = 1
  const stepMm = 1000
  const stepPx = stepMm * scale.value
  if (stepPx < 6) return
  const cw = centerWorld()
  const startX = c.width / 2 - ((cw.x % stepMm) * scale.value)
  const startY = c.height / 2 + ((cw.y % stepMm) * scale.value)
  for (let x = startX % stepPx; x < c.width; x += stepPx) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, c.height)
    ctx.stroke()
  }
  for (let y = startY % stepPx; y < c.height; y += stepPx) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(c.width, y)
    ctx.stroke()
  }
}

function drawMap() {
  if (!props.showMap || !ctx) return

  // 障碍点云(离屏整体缩放绘制)
  if (mapCanvas && mapMeta) {
    const topLeft = worldToScreen({ x: mapMeta.minX, y: mapMeta.maxY })
    const dw = mapMeta.w * mapMeta.res * scale.value
    const dh = mapMeta.h * mapMeta.res * scale.value
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(mapCanvas, 0, 0, mapMeta.w, mapMeta.h, topLeft.x, topLeft.y, dw, dh)
  }

  // 路径点拓扑边
  if (mapPathEdges.length > 0) {
    ctx.strokeStyle = 'rgba(96,165,250,0.35)'
    ctx.lineWidth = 1
    for (const [a, b] of mapPathEdges) {
      const sa = worldToScreen(a)
      const sb = worldToScreen(b)
      ctx.beginPath()
      ctx.moveTo(sa.x, sa.y)
      ctx.lineTo(sb.x, sb.y)
      ctx.stroke()
    }
  }

  // 目标点
  if (mapGoals.length > 0) {
    ctx.fillStyle = '#a78bfa'
    ctx.font = '11px sans-serif'
    for (const g of mapGoals) {
      const s = worldToScreen(g)
      ctx.beginPath()
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillText(g.name, s.x + 6, s.y - 6)
    }
  }
}

function drawPath() {
  if (!ctx || store.pathPoints.length === 0) return
  ctx.strokeStyle = '#38bdf8'
  ctx.lineWidth = 2
  ctx.beginPath()
  store.pathPoints.forEach((p, i) => {
    const s = worldToScreen(p)
    if (i === 0) ctx!.moveTo(s.x, s.y)
    else ctx!.lineTo(s.x, s.y)
  })
  ctx.stroke()
}

function drawClearances() {
  if (!ctx || store.clearances.length < 2) return
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 2
  // clearances.points 为成对线段端点
  for (let i = 0; i + 1 < store.clearances.length; i += 2) {
    const a = worldToScreen(store.clearances[i])
    const b = worldToScreen(store.clearances[i + 1])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
}

function drawLaser() {
  if (!ctx) return
  ctx.fillStyle = '#ef4444'
  for (const group of store.laserGroups) {
    for (const p of group) {
      const s = worldToScreen(p)
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2)
    }
  }
}

function drawRobot() {
  if (!ctx) return
  const [x, y, thDeg] = store.pose
  const th = (thDeg * Math.PI) / 180
  const size = store.robotSize
  const front = size.length_front || size.length / 2 || 400
  const rear = size.length_rear || size.length / 2 || 400
  const halfW = (size.width || 600) / 2

  const corners: Point[] = [
    { x: front, y: halfW },
    { x: front, y: -halfW },
    { x: -rear, y: -halfW },
    { x: -rear, y: halfW }
  ]
  const screenPts = corners.map((c) => {
    const wx = x + c.x * Math.cos(th) - c.y * Math.sin(th)
    const wy = y + c.x * Math.sin(th) + c.y * Math.cos(th)
    return worldToScreen({ x: wx, y: wy })
  })

  ctx.strokeStyle = '#22c55e'
  ctx.lineWidth = 2
  ctx.beginPath()
  screenPts.forEach((p, i) => {
    if (i === 0) ctx!.moveTo(p.x, p.y)
    else ctx!.lineTo(p.x, p.y)
  })
  ctx.closePath()
  ctx.stroke()

  // 朝向线
  const center = worldToScreen({ x, y })
  const head = worldToScreen({ x: x + front * Math.cos(th), y: y + front * Math.sin(th) })
  ctx.strokeStyle = '#86efac'
  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(head.x, head.y)
  ctx.stroke()

  ctx.fillStyle = '#22c55e'
  ctx.beginPath()
  ctx.arc(center.x, center.y, 3, 0, Math.PI * 2)
  ctx.fill()
}

function render() {
  if (ctx && cv.value) {
    drawGrid()
    drawMap()
    drawPath()
    drawClearances()
    drawLaser()
    drawRobot()
  }
  raf = requestAnimationFrame(render)
}

function resize() {
  const w = wrap.value
  const c = cv.value
  if (!w || !c) return
  c.width = w.clientWidth
  c.height = w.clientHeight
}

onMounted(() => {
  ctx = cv.value!.getContext('2d')
  resize()
  ro = new ResizeObserver(resize)
  if (wrap.value) ro.observe(wrap.value)
  const c = cv.value!
  c.addEventListener('wheel', onWheel, { passive: false })
  c.addEventListener('mousedown', onDown)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  buildMapCache()
  if (!userInteracted) initialView()
  render()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (ro && wrap.value) ro.unobserve(wrap.value)
  const c = cv.value
  if (c) {
    c.removeEventListener('wheel', onWheel)
    c.removeEventListener('mousedown', onDown)
  }
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
})
</script>

<style scoped>
.canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  background: #0b1220;
  border-radius: 8px;
  overflow: hidden;
}
.canvas-el {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}
.canvas-el:active {
  cursor: grabbing;
}
.canvas-toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 6px;
  align-items: center;
}
</style>
