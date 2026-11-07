// Dev server reachable from other devices on the same private network (e.g. a phone on home Wi-Fi).
//   npm run dev:lan            -> detects the LAN address of the default route
//   npm run dev:lan -- --ip=192.168.1.20
//   npm run dev:lan -- --preview   -> production build + vite preview (a checked state, not live edits)
// Uses the LOCAL Supabase stack only; the browser gets the publishable key (public by design).
// Do not run it on public networks: anyone on the network can reach the app and the local API.
import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getLocalSupabaseEnv } from './supabase-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

/** Local address of the interface used for the default route (no packets are sent). */
function defaultRouteAddress() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', reject)
    socket.connect(9, '192.0.2.1', () => {
      const { address } = socket.address()
      socket.close()
      resolve(address)
    })
  })
}

const ipArg = process.argv.find((a) => a.startsWith('--ip='))?.slice('--ip='.length)
const ip = ipArg ?? (await defaultRouteAddress())
if (!PRIVATE_IPV4.test(ip)) {
  throw new Error(`Refusing non-private address ${ip}: use only on a private (home) network.`)
}

const { url, publishableKey } = getLocalSupabaseEnv()
const lanSupabaseUrl = new URL(url)
lanSupabaseUrl.hostname = ip

console.log(`App on your network: http://${ip}:5173`)
console.log(`Supabase API for the browser: ${lanSupabaseUrl.origin}`)

const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const env = {
  ...process.env,
  // Variables already in the environment take priority over .env.local in Vite.
  VITE_SUPABASE_URL: lanSupabaseUrl.origin,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
}
// `--preview`: serve a production build (a fixed, checked state) instead of the live dev server.
const preview = process.argv.includes('--preview')

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vite, ...args], { cwd: root, stdio: 'inherit', env })
    child.on('exit', (code) => {
      resolve(code ?? 0)
    })
  })
}

if (preview) {
  const built = await run(['build'])
  if (built !== 0) process.exit(built)
  process.exit(await run(['preview', '--host', ip, '--port', '5173', '--strictPort']))
} else {
  process.exit(await run(['--host', ip]))
}
