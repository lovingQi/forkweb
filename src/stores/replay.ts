import { defineStore } from 'pinia'
import {
  addReplayBookmark,
  clearReplayCache,
  compareReplayPackages,
  createReplaySession,
  createReplaySessionJob,
  deleteReplayBookmark,
  exportReplayPackageOptions,
  getReplayCache,
  getReplayBookmarks,
  getReplayCaseMeta,
  getReplayErrorCodes,
  getReplayEventMarkers,
  getReplayEvents,
  getReplayFrames,
  getReplayFoldedLogLines,
  getReplayLogs,
  getReplayMapAliases,
  getReplayOverview,
  getReplaySession,
  getReplaySessionJob,
  getReplayTasks,
  importReplayPackage,
  importReplayPackageByPath,
  importReplayMapAliases,
  deleteReplayMapAlias,
  saveReplayMapAlias,
  saveReplayCaseMeta,
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
    eventMarkers: [] as any[],
    eventTotal: 0,
    eventFilter: '',
    eventQuery: {
      startMs: 0,
      endMs: 0,
      level: '',
      category: '',
      mode: 'all',
      sort: 'time',
      dedupe: false,
      offset: 0,
      limit: 1000
    },
    frames: [] as any[],
    errorDefinitions: [] as any[],
    errorOccurrences: [] as any[],
    errorSummaries: [] as any[],
    selectedErrorCode: '',
    errorQuery: {
      kind: '',
      level: '',
      module: '',
      code: '',
      taskId: '',
      occurrenceOffset: 0,
      occurrenceLimit: 1000
    },
    errorOccurrenceTotal: 0,
    tasks: [] as any[],
    logs: [] as any[],
    logKeywordMatches: [] as string[],
    folded: [] as any[],
    foldedDetail: {
      id: '',
      lines: [] as any[],
      copyText: '',
      total: 0,
      offset: 0,
      limit: 200
    },
    logCopyText: '',
    mapAliases: [] as any[],
    mapAliasConflicts: [] as any[],
    importedPackage: null as any,
    cacheSummary: null as any,
    logFilter: {
      level: '',
      module: '',
      keyword: '',
      keywords: '',
      startMs: 0,
      endMs: 0,
      aroundTimeMs: 0,
      aroundLines: 0,
      aroundSeconds: 0,
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
    loopEnabled: false,
    loopStartMs: 0,
    loopEndMs: 0,
    autoPauseOnIssue: false,
    selectedTimeMs: 0,
    currentMs: 0,
    currentFrameIndex: 0,
    startMs: 0,
    endMs: 0,
    durationMs: 0,
    bookmarks: [] as any[],
    caseMeta: {} as any,
    sessionJob: null as any,
    packageComparison: null as any,
    lastExportedPackage: null as any
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

    async loadSessionAsync(forceReload = false) {
      this.loading = true
      const created = await createReplaySessionJob({
        logDir: this.logDir,
        mapDir: this.mapDir || undefined,
        mapFile: this.mapFile || undefined,
        forceReload
      })
      this.sessionJob = created.job
      return this.pollSessionJob(created.job.id)
    },

    async pollSessionJob(id: string) {
      for (;;) {
        const res = await getReplaySessionJob(id)
        this.sessionJob = res.job
        if (res.job?.status === 'done') {
          await this.refreshAll()
          this.loaded = true
          this.loading = false
          return res.job
        }
        if (res.job?.status === 'error') {
          this.loading = false
          throw new Error(res.job.error || '解析失败')
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    },

    async refreshAll() {
      const [overview, eventRes, frames, errors, tasks, logs, bookmarks, caseMeta] = await Promise.all([
        getReplayOverview(),
        getReplayEvents(this.eventQuery),
        getReplayFrames(),
        getReplayErrorCodes(this.errorQuery),
        getReplayTasks(),
        getReplayLogs(this.logFilter),
        getReplayBookmarks(),
        getReplayCaseMeta()
      ])
      this.overview = overview
      this.startMs = overview.startMs || 0
      this.endMs = overview.endMs || 0
      this.durationMs = overview.durationMs || 0
      if (!this.currentMs) this.currentMs = this.startMs
      this.events = eventRes.events || []
      this.eventTotal = eventRes.total || this.events.length
      this.frames = frames
      this.errorDefinitions = errors.definitions || []
      this.errorOccurrences = errors.occurrences || []
      this.errorSummaries = errors.summaries || []
      this.errorOccurrenceTotal = errors.occurrenceTotal || this.errorOccurrences.length
      this.tasks = tasks
      this.logs = logs.lines || []
      this.folded = logs.folded || []
      this.logKeywordMatches = logs.keywordMatches || []
      this.logCopyText = logs.copyText || ''
      this.logTotal = logs.total || this.logs.length
      this.bookmarks = bookmarks || []
      this.caseMeta = caseMeta || {}
      await this.refreshEventMarkers()
      await this.refreshMapAliases()
    },

    async refreshLogs() {
      const logs = await getReplayLogs(this.logFilter)
      this.logs = logs.lines || []
      this.folded = logs.folded || []
      this.logKeywordMatches = logs.keywordMatches || []
      this.logCopyText = logs.copyText || ''
      this.logTotal = logs.total || this.logs.length
    },

    async refreshEvents() {
      const res = await getReplayEvents(this.eventQuery)
      this.events = res.events || []
      this.eventTotal = res.total || this.events.length
      await this.refreshEventMarkers()
    },

    async refreshEventMarkers() {
      this.eventMarkers = await getReplayEventMarkers({
        startMs: this.startMs,
        endMs: this.endMs,
        bucketMs: Math.max(1000, Math.floor((this.durationMs || 60000) / 120))
      })
    },

    async refreshErrorCodes() {
      const errors = await getReplayErrorCodes(this.errorQuery)
      this.errorDefinitions = errors.definitions || []
      this.errorOccurrences = errors.occurrences || []
      this.errorSummaries = errors.summaries || []
      this.errorOccurrenceTotal = errors.occurrenceTotal || this.errorOccurrences.length
    },

    async loadFoldedDetail(id: string, offset = 0) {
      const res = await getReplayFoldedLogLines(id, { offset, limit: this.foldedDetail.limit })
      this.foldedDetail = {
        id,
        lines: res.lines || [],
        copyText: res.copyText || '',
        total: res.total || 0,
        offset: res.offset || 0,
        limit: res.limit || this.foldedDetail.limit
      }
      return res
    },

    async changeFoldedDetailPage(page: number) {
      if (!this.foldedDetail.id) return
      const offset = Math.max(0, (page - 1) * this.foldedDetail.limit)
      await this.loadFoldedDetail(this.foldedDetail.id, offset)
    },

    async changeLogPage(page: number) {
      this.logFilter.offset = Math.max(0, (page - 1) * this.logFilter.limit)
      await this.refreshLogs()
    },

    async changeEventPage(page: number) {
      this.eventQuery.offset = Math.max(0, (page - 1) * this.eventQuery.limit)
      await this.refreshEvents()
    },

    async changeErrorOccurrencePage(page: number) {
      this.errorQuery.occurrenceOffset = Math.max(0, (page - 1) * this.errorQuery.occurrenceLimit)
      await this.refreshErrorCodes()
    },

    async play() {
      const res = await setReplayControl({
        playing: true,
        speed: this.speed,
        mode: this.mode,
        loopEnabled: this.loopEnabled,
        loopStartMs: this.loopStartMs || undefined,
        loopEndMs: this.loopEndMs || undefined,
        autoPauseOnIssue: this.autoPauseOnIssue
      })
      this.applyControl(res.control)
    },

    async pause() {
      const res = await setReplayControl({ playing: false })
      this.applyControl(res.control)
    },

    async setSpeed(speed: number) {
      this.speed = speed
      const res = await setReplayControl({ speed })
      this.applyControl(res.control)
    },

    async setMode(mode: ReplayMode) {
      this.mode = mode
      const res = await setReplayControl({ mode })
      this.applyControl(res.control)
    },

    async updateControlOptions() {
      const res = await setReplayControl({
        loopEnabled: this.loopEnabled,
        loopStartMs: this.loopStartMs || undefined,
        loopEndMs: this.loopEndMs || undefined,
        autoPauseOnIssue: this.autoPauseOnIssue
      })
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
      this.loopEnabled = !!control.loopEnabled
      this.loopStartMs = Number(control.loopStartMs || 0)
      this.loopEndMs = Number(control.loopEndMs || 0)
      this.autoPauseOnIssue = !!control.autoPauseOnIssue
    },

    async saveCurrentMapAlias() {
      const match = this.overview?.mapMatch || {}
      const res = await saveReplayMapAlias({
        detectedMapName: match.detectedMapName,
        selectedMapFile: match.selectedMapFile,
        robotName: this.overview?.robotName
      })
      await this.refreshMapAliases()
      return res
    },

    async refreshMapAliases() {
      const res = await getReplayMapAliases()
      this.mapAliases = res.aliases || []
      this.mapAliasConflicts = res.conflicts || []
      return res
    },

    async deleteMapAlias(id: string) {
      const res = await deleteReplayMapAlias(id)
      await this.refreshMapAliases()
      return res
    },

    async importMapAliases(aliases: any[], overwrite = false) {
      const res = await importReplayMapAliases({ aliases, overwrite })
      this.mapAliases = res.aliases || []
      this.mapAliasConflicts = res.conflicts || []
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

    async importPackageByPath(packagePath: string) {
      const res = await importReplayPackageByPath({ path: packagePath })
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

    async clearCache(bucket?: string) {
      const res = await clearReplayCache(bucket)
      this.cacheSummary = res.cache
      return res
    },

    async refreshBookmarks() {
      this.bookmarks = await getReplayBookmarks()
      return this.bookmarks
    },

    async addBookmark(payload: Record<string, any>) {
      const res = await addReplayBookmark(payload)
      this.bookmarks = res.bookmarks || this.bookmarks
      return res.bookmark
    },

    async deleteBookmark(id: string) {
      const res = await deleteReplayBookmark(id)
      this.bookmarks = res.bookmarks || this.bookmarks.filter((it) => it.id !== id)
      return res
    },

    async refreshCaseMeta() {
      this.caseMeta = await getReplayCaseMeta()
      return this.caseMeta
    },

    async saveCaseMeta(payload: Record<string, any>) {
      const res = await saveReplayCaseMeta(payload)
      this.caseMeta = res.caseMeta || payload
      return this.caseMeta
    },

    async exportPackageWithOptions(payload: Record<string, any>) {
      const res = await exportReplayPackageOptions(payload)
      this.lastExportedPackage = res.package
      return res.package
    },

    async comparePackages(left: Record<string, any>, right: Record<string, any>) {
      const res = await compareReplayPackages({ left, right })
      this.packageComparison = res.comparison
      return this.packageComparison
    }
  }
})
