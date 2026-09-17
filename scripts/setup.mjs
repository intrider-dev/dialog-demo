import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

export function command(program, args, options = {}) {
  // npm.cmd is not a native executable on Windows. Only fixed npm commands go through cmd.exe.
  const windowsNpm = process.platform === 'win32' && program === 'npm'
  if (windowsNpm && args.some((arg) => !/^[a-z:-]+$/.test(arg)))
    throw new Error('Invalid npm argument')
  const result = spawnSync(
    windowsNpm ? 'cmd.exe' : program,
    windowsNpm ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args,
    {
      encoding: 'utf8',
      stdio: options.capture ? 'pipe' : 'inherit',
      ...options,
    },
  )
  if (result.error || result.status !== 0)
    throw new Error(`${program} failed. Check that it is installed and running.`)
  return result.stdout?.trim() ?? ''
}

export function mergeEnv(existing, defaults) {
  const values = parseEnv(existing)
  let text = existing.endsWith('\n') || !existing ? existing : `${existing}\n`
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in values)) text += `${key}=${JSON.stringify(value)}\n`
  }
  return text
}

export function databaseSettings(container) {
  if (!/^postgres(?::|@)/.test(container.Config.Image))
    throw new Error('The existing container is not the official PostgreSQL image.')
  const env = Object.fromEntries(
    container.Config.Env.map((value) => {
      const i = value.indexOf('=')
      return [value.slice(0, i), value.slice(i + 1)]
    }),
  )
  const binding = container.HostConfig.PortBindings?.['5432/tcp']?.find((value) =>
    ['127.0.0.1', '::1'].includes(value.HostIp),
  )
  if (!binding || !env.POSTGRES_PASSWORD)
    throw new Error(
      'Use a localhost PostgreSQL port and password, or run with --skip-docker and set DATABASE_URL.',
    )
  const user = env.POSTGRES_USER || 'postgres'
  const database = env.POSTGRES_DB || user
  const host = binding.HostIp === '::1' ? '[::1]' : '127.0.0.1'
  return {
    user,
    database,
    url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@${host}:${binding.HostPort}/${encodeURIComponent(database)}`,
  }
}

export async function verifyInstallation(root, env) {
  const { readConfig } = await import(pathToFileURL(resolve(root, 'server/dist/config.js')).href)
  const { createStore } = await import(pathToFileURL(resolve(root, 'server/dist/db.js')).href)
  const config = readConfig(env)
  const store = createStore(config.databaseUrl)
  try {
    await store.init()
    await store.health()
  } finally {
    await store.close()
  }
}

export async function setup(
  args = process.argv.slice(2),
  run = command,
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  verify = verifyInstallation,
) {
  if (args.some((arg) => !['--check', '--skip-docker'].includes(arg)))
    throw new Error('Supported options: --check, --skip-docker')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 14)) throw new Error('Install Node.js 24.14 or newer.')
  const envPath = resolve(root, 'server/.env')
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const env = parseEnv(current)
  run('npm', ['--version'], { cwd: root, capture: true })
  if (args.includes('--check')) {
    if (!env.DATABASE_URL || !env.SESSION_SECRET)
      throw new Error('Run the installer once to create server/.env.')
    console.log('Node.js, npm and server/.env are ready.')
    return
  }
  let databaseUrl = env.DATABASE_URL
  if (!args.includes('--skip-docker')) {
    run('docker', ['info'], { capture: true })
    const name = 'local-postgres'
    const names = run('docker', ['ps', '-a', '--format', '{{.Names}}'], { capture: true }).split(
      /\r?\n/,
    )
    if (!names.includes(name)) {
      const password = randomBytes(32).toString('hex')
      // Pass the password through the child environment, not command-line arguments or logs.
      run(
        'docker',
        [
          'run',
          '-d',
          '--name',
          name,
          '--restart',
          'unless-stopped',
          '-p',
          '127.0.0.1:5433:5432',
          '-e',
          'POSTGRES_PASSWORD',
          '-e',
          'POSTGRES_USER=postgres',
          '-e',
          'POSTGRES_DB=postgres',
          '-v',
          'local-postgres-data:/var/lib/postgresql',
          'postgres:18',
        ],
        { env: { ...process.env, POSTGRES_PASSWORD: password } },
      )
    }
    const container = JSON.parse(run('docker', ['inspect', name], { capture: true }))[0]
    const settings = databaseSettings(container)
    if (!container.State.Running) run('docker', ['start', name])
    databaseUrl ??= settings.url
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        run('docker', ['exec', name, 'pg_isready', '-U', settings.user, '-d', settings.database], {
          capture: true,
        })
        ready = true
        break
      } catch {
        await new Promise((done) => setTimeout(done, 1000))
      }
    }
    if (!ready) throw new Error('PostgreSQL did not start. Check docker logs local-postgres.')
  }
  if (!databaseUrl) throw new Error('Set DATABASE_URL in server/.env before using --skip-docker.')
  const next = mergeEnv(current, {
    HOST: '127.0.0.1',
    PORT: '3001',
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: randomBytes(48).toString('hex'),
    AI_BASE_URL: 'https://openrouter.ai/api/v1',
    AI_MODEL: 'openai/gpt-4.1-nano',
    AI_API_KEY: '',
    COOKIE_SECURE: 'false',
    REQUESTS_PER_MINUTE: '15',
    DAILY_REQUEST_LIMIT: '100',
  })
  writeFileSync(envPath, next, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(envPath, 0o600)
  run('npm', ['ci'], { cwd: root })
  run('npm', ['run', 'build'], { cwd: root })
  await verify(root, parseEnv(next))
  console.log('Ready. Add your key to server/.env, then run: npm run dev')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setup().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
