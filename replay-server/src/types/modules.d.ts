declare module 'unzipper' {
  import type { Readable } from 'stream'
  export function Extract(options: { path: string }): NodeJS.WritableStream
  export function Parse(): NodeJS.WritableStream
  export function parse(): NodeJS.WritableStream
}

declare module 'tar' {
  export function x(options: { file: string; cwd: string }): Promise<void>
  export function extract(options: { file: string; cwd: string }): Promise<void>
}
