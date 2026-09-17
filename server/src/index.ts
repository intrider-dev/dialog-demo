import { fileURLToPath } from 'node:url'
import { readConfig } from './config.js'
import { createStore } from './db.js'
import { createApp } from './app.js'

const config = readConfig()
const store = createStore(config.databaseUrl)
await store.init()
const app = createApp(
  config,
  store,
  undefined,
  fileURLToPath(new URL('../../client/dist/', import.meta.url)),
)
const server = app.listen(config.port, config.host, () =>
  console.log(`Server: http://${config.host}:${config.port}`),
)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void store.close().then(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
