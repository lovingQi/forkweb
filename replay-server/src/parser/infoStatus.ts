import type { ParsedLogLine, ReplayFrame } from '../types'

const POSE_RE = /loc\(pose\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?),\s+state\s*([^,]*),\s+score\s+(-?\d+(?:\.\d+)?)\)/
const ODOM_RE = /odom\(pose\s+[^)]*?,\s+v\s+(-?\d+(?:\.\d+)?),\s+w\s+(-?\d+(?:\.\d+)?)\)/
const VEL_RE = /vel to base\(vx\s+(-?\d+(?:\.\d+)?),\s+vy\s+(-?\d+(?:\.\d+)?),\s+w\s+(-?\d+(?:\.\d+)?)\)/
const STATE_RE = /ROBOT STATUS:\s+state\(([^)]*)\)/
const MOTOR_RE = /motor\(([^)]*)\)/
const CHARGING_RE = /charging\(([^)]*)\)/
const BATTERY_RE = /battery\((-?\d+(?:\.\d+)?)\)/

export function parseInfoStatus(line: ParsedLogLine): ReplayFrame | null {
  if (!line.message.includes('ROBOT STATUS:')) return null
  const pose = line.message.match(POSE_RE)
  if (!pose) return null
  const x = Number(pose[1])
  const y = Number(pose[2])
  const theta = Number(pose[3])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(theta)) return null
  const state = line.message.match(STATE_RE)
  const odom = line.message.match(ODOM_RE)
  const vel = line.message.match(VEL_RE)
  const motor = line.message.match(MOTOR_RE)
  const charging = line.message.match(CHARGING_RE)
  const battery = line.message.match(BATTERY_RE)
  return {
    timestamp: line.timestamp,
    timeMs: line.timeMs,
    source: 'InfoStatus',
    x,
    y,
    theta,
    status: state ? state[1] : pose[4],
    score: Number(pose[5]),
    battery: battery ? Number(battery[1]) : undefined,
    motor: motor ? motor[1] === 'enabled' : undefined,
    charging: charging ? charging[1] === '1' : undefined,
    vx: vel ? Number(vel[1]) : undefined,
    vy: vel ? Number(vel[2]) : undefined,
    w: vel ? Number(vel[3]) : odom ? Number(odom[2]) : undefined,
    rawLine: line
  }
}
