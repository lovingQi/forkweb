import type { DiagnosticPackageManifest } from './diagnosticPackage'

export function comparePackageManifests(left: DiagnosticPackageManifest, right: DiagnosticPackageManifest) {
  return {
    version: {
      left: left.version,
      right: right.version,
      same: left.version === right.version
    },
    robotName: {
      left: left.robotName,
      right: right.robotName,
      same: left.robotName === right.robotName
    },
    mapName: {
      left: left.overview?.mapName || '',
      right: right.overview?.mapName || '',
      same: (left.overview?.mapName || '') === (right.overview?.mapName || '')
    },
    errorCount: {
      left: left.overview?.errorCount || 0,
      right: right.overview?.errorCount || 0,
      delta: (right.overview?.errorCount || 0) - (left.overview?.errorCount || 0)
    },
    taskCount: {
      left: left.overview?.taskCount || 0,
      right: right.overview?.taskCount || 0,
      delta: (right.overview?.taskCount || 0) - (left.overview?.taskCount || 0)
    },
    frameCount: {
      left: left.overview?.frameCount || 0,
      right: right.overview?.frameCount || 0,
      delta: (right.overview?.frameCount || 0) - (left.overview?.frameCount || 0)
    }
  }
}
