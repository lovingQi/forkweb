import { defineStore } from 'pinia'
import {
  createReplaySession,
  getReplayErrorCodes,
  getReplayEvents,
  getReplayFrames,
  getReplayLogs,
  getReplayOverview,
  getReplaySession,
  getReplayTasks,
  seekReplay,
  setReplayControl
} from '@/api/replay'

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
    logFilter: {
      level: '',
      module: '',
      keyword: '',
      startMs: 0,
      endMs: 0,
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
    selectedTimeMs: 0,
    currentMs: 0,
    startMs: 0,
    endMs: 0,
    durationMs: 0
  }),

  actions: {
    async loadSession() {
      this.loading = true
      try {
        await createReplaySession({
          logDir: this.logDir,
          mapDir: this.mapDir || undefined,
          mapFile: this.mapFile || undefined
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
      this.logTotal = logs.total || this.logs.length
    },

    async refreshLogs() {
      const logs = await getReplayLogs(this.logFilter)
      this.logs = logs.lines || []
      this.folded = logs.folded || []
      this.logTotal = logs.total || this.logs.length
    },

    async changeLogPage(page: number) {
      this.logFilter.offset = Math.max(0, (page - 1) * this.logFilter.limit)
      await this.refreshLogs()
    },

    async play() {
      const res = await setReplayControl({ playing: true, speed: this.speed })
      this.playing = !!res.control?.playing
      this.currentMs = res.control?.currentMs || this.currentMs
    },

    async pause() {
      const res = await setReplayControl({ playing: false })
      this.playing = !!res.control?.playing
      this.currentMs = res.control?.currentMs || this.currentMs
    },

    async setSpeed(speed: number) {
      this.speed = speed
      await setReplayControl({ speed })
    },

    async seek(timeMs: number) {
      this.selectedTimeMs = timeMs
      this.currentMs = timeMs
      const res = await seekReplay(timeMs)
      this.currentMs = res.control?.currentMs || timeMs
    },

    async refreshSession() {
      const res = await getReplaySession()
      this.playing = !!res.control?.playing
      this.currentMs = res.control?.currentMs || this.currentMs
      if (res.overview) {
        this.startMs = res.overview.startMs || this.startMs
        this.endMs = res.overview.endMs || this.endMs
        this.durationMs = res.overview.durationMs || this.durationMs
      }
    }
  }
})
