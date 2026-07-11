import { defineStore } from 'pinia'
import {
  clearReplayCache,
  createReplaySession,
  getReplayCache,
  getReplayErrorCodes,
  getReplayEvents,
  getReplayFrames,
  getReplayLogs,
  getReplayMapAliases,
  getReplayOverview,
  getReplaySession,
  getReplayTasks,
  importReplayPackage,
  saveReplayMapAlias,
  seekReplay,
  sendRootCauseFeedback,
  setReplayControl
} from '@/api/replay'
import type { ReplayMode } from '@/api/replay'

export const useReplayStore = defineStore('replay', {
  state: () => ({
    logDir: '/home/xbl/Desktop',
    mapDir: '/home/xbl/Desktop/jarvis-fork/params/map',
    mapFile: '',
    loading: false,
    loaded: false,
    overview: null as any,
    events: [] as any[],
    eventFilter: '',
    frames: [] as any[],
    errorDefinitions: [] as any[],
    errorOccurrences: [] as any[],
    errorSummaries: [] as any[],
    selectedErrorCode: '',
    tasks: [] as any[],
    logs: [] as any[],
    folded: [] as any[],
    logCopyText: '',
    mapAliases: [] as any[],
    importedPackage: null as any,
    cacheSummary: null as any,
    logFilter: {
      level: '',
      module: '',
      keyword: '',
      startMs: 0,
      endMs: 0,
      aroundTimeMs: 0,
      aroundLines: 0,
      errorCode: '',
      taskId: '',
      noise: '',
      important: '',
      offset: 0,
      limit: 500
    },
    logTotal: 0,
    playing: false,
    speed: 1,
    mode: 'realtime' as ReplayMode,
    selectedTimeMs: 0,
    currentMs: 0,
    currentFrameIndex: 0,
    startMs: 0,
    endMs: 0,
    durationMs: 0
  }),

  actions: {
    async loadSession(forceReload = false) {
      this.loading = true
      try {
        await createReplaySession({
          logDir: this.logDir,
          mapDir: this.mapDir || undefined,
          mapFile: this.mapFile || undefined,
          forceReload
        })
        await this.refreshAll()
        this.loaded = true
      } finally {
        this.loading = false
      }
    },

    async refreshAll() {
      const [overview, events, frames, errors, tasks, logs] = await Promise.all([
        getReplayOverview(),
        getReplayEvents(),
        getReplayFrames(),
        getReplayErrorCodes(),
        getReplayTasks(),
        getReplayLogs(this.logFilter)
      ])
      this.overview = overview
      this.startMs = overview.startMs || 0
      this.endMs = overview.endMs || 0
      this.durationMs = overview.durationMs || 0
      if (!this.currentMs) this.currentMs = this.startMs
      this.events = events
      this.frames = frames
      this.errorDefinitions = errors.definitions || []
      this.errorOccurrences = errors.occurrences || []
      this.errorSummaries = errors.summaries || []
      this.tasks = tasks
      this.logs = logs.lines || []
      this.folded = logs.folded || []
      this.logCopyText = logs.copyText || ''
      this.logTotal = logs.total || this.logs.length
      this.mapAliases = await getReplayMapAliases()
    },

    async refreshLogs() {
      const logs = await getReplayLogs(this.logFilter)
      this.logs = logs.lines || []
      this.folded = logs.folded || []
      this.logCopyText = logs.copyText || ''
      this.logTotal = logs.total || this.logs.length
    },

    async changeLogPage(page: number) {
      this.logFilter.offset = Math.max(0, (page - 1) * this.logFilter.limit)
      await this.refreshLogs()
    },

    async play() {
      const res = await setReplayControl({ playing: true, speed: this.speed, mode: this.mode })
      this.applyControl(res.control)
    },

    async pause() {
      const res = await setReplayControl({ playing: false })
      this.applyControl(res.control)
    },

    async setSpeed(speed: number) {
      this.speed = speed
      await setReplayControl({ speed })
    },

    async setMode(mode: ReplayMode) {
      this.mode = mode
      const res = await setReplayControl({ mode })
      this.applyControl(res.control)
    },

    async seek(timeMs: number) {
      this.selectedTimeMs = timeMs
      this.currentMs = timeMs
      const res = await seekReplay(timeMs)
      this.applyControl(res.control)
    },

    async seekFrame(frameIndex: number) {
      this.currentFrameIndex = frameIndex
      const res = await seekReplay({ frameIndex })
      this.applyControl(res.control)
    },

    async refreshSession() {
      const res = await getReplaySession()
      this.applyControl(res.control)
      if (res.overview) {
        this.startMs = res.overview.startMs || this.startMs
        this.endMs = res.overview.endMs || this.endMs
        this.durationMs = res.overview.durationMs || this.durationMs
      }
    },

    applyControl(control: any) {
      if (!control) return
      this.playing = !!control.playing
      this.currentMs = control.currentMs || this.currentMs
      this.currentFrameIndex = Number.isFinite(Number(control.currentFrameIndex))
        ? Number(control.currentFrameIndex)
        : this.currentFrameIndex
      if (control.mode === 'realtime' || control.mode === 'frame_compact') this.mode = control.mode
    },

    async saveCurrentMapAlias() {
      const match = this.overview?.mapMatch || {}
      const res = await saveReplayMapAlias({
        detectedMapName: match.detectedMapName,
        selectedMapFile: match.selectedMapFile,
        robotName: this.overview?.robotName
      })
      this.mapAliases = await getReplayMapAliases()
      return res
    },

    async sendRootCauseFeedback(id: string, verdict: 'useful' | 'false_positive') {
      return sendRootCauseFeedback(id, { verdict })
    },

    async importPackage(fileName: string, content: string) {
      const res = await importReplayPackage({ fileName, content })
      this.importedPackage = res.package
      if (res.package?.logDir) this.logDir = res.package.logDir
      if (res.package?.mapDir) this.mapDir = res.package.mapDir
      if (res.package?.mapFile) this.mapFile = res.package.mapFile
      await this.refreshAll()
      this.loaded = true
      return res
    },

    async refreshCacheSummary() {
      this.cacheSummary = await getReplayCache()
      return this.cacheSummary
    },

    async clearCache() {
      const res = await clearReplayCache()
      this.cacheSummary = res.cache
      return res
    }
  }
})
