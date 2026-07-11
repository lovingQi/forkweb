import { defineStore } from 'pinia'
import {
  createReplaySession,
  getReplayErrorCodes,
  getReplayEvents,
  getReplayLogs,
  getReplayOverview,
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
    errorDefinitions: [] as any[],
    errorOccurrences: [] as any[],
    tasks: [] as any[],
    logs: [] as any[],
    folded: [] as any[],
    logFilter: {
      level: '',
      module: '',
      keyword: '',
      limit: 500
    },
    playing: false,
    speed: 1,
    selectedTimeMs: 0
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
      const [overview, events, errors, tasks, logs] = await Promise.all([
        getReplayOverview(),
        getReplayEvents(),
        getReplayErrorCodes(),
        getReplayTasks(),
        getReplayLogs(this.logFilter)
      ])
      this.overview = overview
      this.events = events
      this.errorDefinitions = errors.definitions || []
      this.errorOccurrences = errors.occurrences || []
      this.tasks = tasks
      this.logs = logs.lines || []
      this.folded = logs.folded || []
    },

    async refreshLogs() {
      const logs = await getReplayLogs(this.logFilter)
      this.logs = logs.lines || []
      this.folded = logs.folded || []
    },

    async play() {
      const res = await setReplayControl({ playing: true, speed: this.speed })
      this.playing = !!res.control?.playing
    },

    async pause() {
      const res = await setReplayControl({ playing: false })
      this.playing = !!res.control?.playing
    },

    async setSpeed(speed: number) {
      this.speed = speed
      await setReplayControl({ speed })
    },

    async seek(timeMs: number) {
      this.selectedTimeMs = timeMs
      await seekReplay(timeMs)
    }
  }
})
