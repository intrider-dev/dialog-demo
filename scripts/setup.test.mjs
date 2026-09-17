import { expect, it, vi } from 'vitest'
import { command, databaseSettings, mergeEnv, setup } from './setup.mjs'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('keeps existing credentials, comments and quoted values on repeat setup', () => {
  const existing = '# local\nAI_API_KEY="secret"\nPORT=4321'
  const merged = mergeEnv(existing, { AI_API_KEY: '', PORT: '3001', HOST: '127.0.0.1' })
  expect(merged).toContain('AI_API_KEY="secret"')
  expect(merged).toContain('PORT=4321')
  expect(mergeEnv(merged, { HOST: 'other' })).toBe(merged)
  expect(mergeEnv('', { TEST: 'value' })).toBe('TEST="value"\n')
})
it('reads the real Docker user, database and local port with URL escaping', () => {
  const container = {
    Config: {
      Image: 'postgres:18',
      Env: ['POSTGRES_PASSWORD=p@ss:word', 'POSTGRES_USER=user', 'POSTGRES_DB=chat'],
    },
    HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5433' }] } },
  }
  expect(databaseSettings(container).url).toBe(
    'postgresql://user:p%40ss%3Aword@127.0.0.1:5433/chat',
  )
  expect(() =>
    databaseSettings({ ...container, Config: { ...container.Config, Image: 'untrusted/image' } }),
  ).toThrow()
  expect(() => databaseSettings({ ...container, HostConfig: {} })).toThrow()
  expect(
    databaseSettings({
      ...container,
      Config: { Image: 'postgres:18', Env: ['POSTGRES_PASSWORD=secret'] },
    }).user,
  ).toBe('postgres')
})
it('runs native commands without shell interpolation and reports failures without arguments', () => {
  expect(command(process.execPath, ['--version'], { capture: true })).toMatch(/^v/)
  expect(() => command(process.execPath, ['-e', 'process.exit(1)'], { capture: true })).toThrow(
    'failed',
  )
  if (process.platform === 'win32')
    expect(() => command('npm', ['ci & echo secret'])).toThrow('Invalid')
  expect(() =>
    command(process.execPath, ['scripts/setup.mjs', '--unknown'], { capture: true }),
  ).toThrow('failed')
})
it('checks prerequisites without installing or changing files', async () => {
  const execute = vi.fn().mockReturnValue('11')
  await setup(['--check'], execute)
  expect(execute).toHaveBeenCalledTimes(1)
  await expect(setup(['--unknown'], execute)).rejects.toThrow('Supported options')
})

it('installs from scratch, waits for the database and preserves credentials on a second run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dialog-setup-'))
  mkdirSync(join(root, 'server'))
  const container = {
    Config: { Image: 'postgres:18', Env: ['POSTGRES_PASSWORD=test-secret'] },
    HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5433' }] } },
    State: { Running: false },
  }
  let ready = false
  const execute = vi.fn((program, args) => {
    if (args[0] === 'inspect') return JSON.stringify([container])
    if (args[0] === 'exec' && !ready) {
      ready = true
      throw new Error('starting')
    }
    return ''
  })
  try {
    const verify = vi.fn().mockResolvedValue(undefined)
    await setup([], execute, root, verify)
    expect(verify).toHaveBeenCalledTimes(1)
    const envPath = join(root, 'server/.env')
    const original = readFileSync(envPath, 'utf8')
    expect(original).toContain('test-secret')
    expect(execute.mock.calls.some(([, args]) => args.includes('POSTGRES_PASSWORD'))).toBe(true)
    expect(
      execute.mock.calls.some(([program, args]) => program === 'npm' && args[0] === 'ci'),
    ).toBe(true)
    await setup(['--skip-docker'], execute, root, verify)
    expect(readFileSync(envPath, 'utf8')).toBe(original)
    writeFileSync(envPath, '')
    await expect(setup(['--skip-docker'], execute, root)).rejects.toThrow('DATABASE_URL')
    await expect(setup(['--check'], execute, root)).rejects.toThrow('Run the installer')
  } finally {
    expect(root.startsWith(join(tmpdir(), 'dialog-setup-'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }
})
