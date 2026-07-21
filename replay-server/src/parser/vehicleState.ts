import type { ParsedLogLine, VehicleStateName, VehicleStateOccurrence } from '../types'

const VEHICLE_STATE_RE = /\bget flt state\s+(\d+)\b/i

export const VEHICLE_STATE_BY_CODE: Partial<Record<number, VehicleStateName>> = {
  1: 'FrontTruck',
  2: 'BackTruck',
  3: 'SideTruck',
  4: 'LeftTruck',
  5: 'RightTruck',
  12: 'LowPower',
  19: 'ForkTipActive',
  24: 'EStopEnable',
  27: 'CollisionStrip',
  30: 'SaftyActive',
  37: 'EStop'
}

export function parseVehicleState(line: ParsedLogLine): VehicleStateOccurrence | null {
  if (line.module !== 'JFltState') return null
  const matched = line.message.match(VEHICLE_STATE_RE)
  if (!matched) return null
  const stateCode = Number(matched[1])
  const state = VEHICLE_STATE_BY_CODE[stateCode]
  if (!state) return null
  return {
    state,
    stateCode,
    timestamp: line.timestamp,
    timeMs: line.timeMs,
    line
  }
}
