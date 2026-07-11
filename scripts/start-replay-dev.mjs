import { spawn } from 'child_process'
import fs from 'fs/promises'
import net from 'net'
import path from 'path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const replayPort = await firstFreePort(18080)
const vitePort = await firstFreePort(5173)

await writeRuntimeConfig(replayPort)

const nodeRunner = process.versions.node.split('.')[0] >= 18 ? 'npm' : 'npx'
const replayArgs = nodeRunner === 'npm'
  ? ['run', 'replay:dev']
  : ['-y', '-p', 'node@20', '-c', 'npm run replay:dev']
const viteArgs = nodeRunner === 'npm'
  ? ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(vitePort)]
  : ['-y', '-p', 'node@20', '-c', `npm run dev -- --host 127.0.0.1 --port ${vitePort}`]

console.log(`replay server: http://127.0.0.1:${replayPort}`)
console.log(`forkweb:       http://127.0.0.1:${vitePort}/replay`)

const children = [
  spawn(nodeRunner, replayArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, REPLAY_PORT: String(replayPort) }
  }),
  spawn(nodeRunner, viteArgs, {
    cwd: root,
    stdio: 'inherit'
  })
]

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal)
    process.exit(0)
  })
}

async function writeRuntimeConfig(port) {
  const text = `// 运行时后端地址配置。\nwindow.__APP_CONFIG__ = {\n  apiBase: '/api',\n  wsBase: '/ws',\n  replayApiBase: 'http://127.0.0.1:${port}/api',\n  replayWsBase: 'ws://127.0.0.1:${port}/ws'\n}\n`
  await fs.writeFile(path.join(root, 'public/config.js'), text, 'utf8')
}

async function firstFreePort(start) {
  for (let port = start; port < start + 20; port++) {
    if (await isFree(port)) return port
  }
  throw new Error(`No free port from ${start}`)
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}
