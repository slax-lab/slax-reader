import Cloudflare from 'cloudflare'
import { loadApiEnv } from '../env'

import { readConfig, parseArgs } from './config'
import type { TomlTable } from 'smol-toml'

const options = parseArgs(process.argv.slice(2), ['--apply'])
if (options.target) throw new Error('resources does not accept a Worker target')
const source = readConfig(options.config, options.environment)
const rows = (value: unknown): TomlTable[] => (Array.isArray(value) ? (value as TomlTable[]) : [])
const queues = source.queues as TomlTable
const config = {
  d1_databases: rows(source.d1_databases).map(db => ({
    name: String(db.database_name),
    binding: String(db.binding),
    id: String(db.database_id || ''),
    preview_id: '',
    migrations_dir: String(db.migrations_dir || '')
  })),
  r2_buckets: rows(source.r2_buckets)
    .flatMap(bucket => [String(bucket.bucket_name), ...(bucket.preview_bucket_name ? [String(bucket.preview_bucket_name)] : [])])
    .map(name => ({ name, binding: name })),
  vectorize_indexes: rows(source.vectorize).map(index => ({ name: String(index.index_name), binding: String(index.binding) })),
  queues: [
    ...new Set(
      [...rows(queues?.producers), ...rows(queues?.consumers)].flatMap(queue => [String(queue.queue), ...(queue.dead_letter_queue ? [String(queue.dead_letter_queue)] : [])])
    )
  ].map(name => ({ name, binding: name })),
  kv_namespaces: rows(source.kv_namespaces).map(ns => ({ name: `${source.name}-${ns.binding}`, binding: String(ns.binding), id: String(ns.id || '') }))
}
if (!options.flags.has('--apply')) {
  console.log('Resource plan (no network calls). Run pnpm api -- resources --apply to create missing resources in the configured account.')
  console.log(
    JSON.stringify(
      {
        d1: config.d1_databases.map(x => x.name),
        r2: config.r2_buckets.map(x => x.name),
        vectorize: config.vectorize_indexes.map(x => x.name),
        queues: config.queues.map(x => x.name),
        kv: config.kv_namespaces.map(x => x.name)
      },
      null,
      2
    )
  )
  process.exit(0)
}

loadApiEnv()
const api = {
  email: process.env.CLOUDFLARE_EMAIL,
  apiKey: process.env.CLOUDFLARE_API_KEY,
  accountId: String(source.account_id || process.env.CLOUDFLARE_ACCOUNT_ID || '')
}

const client = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  apiEmail: api.email,
  apiKey: api.apiKey
})

class ResourceManager {
  constructor(private accountId: string) {
    if (!accountId) {
      throw new Error('Account ID is required')
    }
    this.accountId = accountId
  }

  async initializeAll() {
    await Promise.all([this.initializeD1Databases(), this.initializeR2Buckets(), this.initializeVectorizeIndexes(), this.initializeQueues(), this.initializeKVNamespaces()])
  }

  async initializeD1Databases() {
    const existingDatabases = []
    for await (const item of client.d1.database.list({ account_id: this.accountId })) existingDatabases.push(item)

    for (const db of config.d1_databases) {
      const existing = existingDatabases.find(d => d.uuid === db.id) ?? existingDatabases.find(d => d.name === db.name)

      if (existing) {
        db.id = existing.uuid!
        console.log(`✅ existing ${db.name} (${db.binding}) - ID: ${db.id}`)
      } else {
        const newDb = await client.d1.database.create({
          account_id: this.accountId,
          name: db.name,
          primary_location_hint: 'apac'
        })
        db.id = newDb.uuid!
        console.log(`🔧 create ${db.name} (${db.binding}) - ID: ${db.id}`)
      }
    }
  }

  async initializeR2Buckets() {
    const existingBuckets = await client.r2.buckets.list({
      account_id: this.accountId
    })

    for (const bucket of config.r2_buckets) {
      const existing = existingBuckets.buckets?.find(b => b.name === bucket.name)

      if (existing) {
        console.log(`✅ existing ${bucket.name} (${bucket.binding})`)
      } else {
        await client.r2.buckets.create({
          account_id: this.accountId,
          name: bucket.name
        })
        console.log(`🔧 create ${bucket.name} (${bucket.binding})`)
      }
    }
  }

  async initializeVectorizeIndexes() {
    const existingIndexes = []
    for await (const item of client.vectorize.indexes.list({ account_id: this.accountId })) existingIndexes.push(item)

    for (const index of config.vectorize_indexes) {
      const existing = existingIndexes.find(i => i.name === index.name)

      if (existing) {
        console.log(`✅ existing ${index.name} (${index.binding})`)
      } else {
        await client.vectorize.indexes.create({
          account_id: this.accountId,
          name: index.name,
          config: {
            dimensions: 1024,
            metric: 'cosine'
          }
        })
        console.log(`🔧 create ${index.name} (${index.binding})`)
        await client.vectorize.indexes.metadataIndex.create(index.name, {
          account_id: this.accountId,
          indexType: 'number',
          propertyName: 'bookmark_id'
        })
        console.log(`🔧 create metadata index ${index.name}.bookmark_id`)
      }
    }
  }

  async initializeQueues() {
    const existingQueues = []
    for await (const item of client.queues.list({ account_id: this.accountId })) existingQueues.push(item)

    for (const queue of config.queues) {
      const existing = existingQueues.find(q => q.queue_name === queue.name)

      if (existing) {
        console.log(`✅ existing ${queue.name} (${queue.binding})`)
      } else {
        await client.queues.create({
          account_id: this.accountId,
          queue_name: queue.name
        })
        console.log(`🔧 create queue ${queue.name} (${queue.binding})`)
      }
    }
  }

  async initializeKVNamespaces() {
    const existingNamespaces = []
    for await (const item of client.kv.namespaces.list({ account_id: this.accountId })) existingNamespaces.push(item)

    for (const ns of config.kv_namespaces) {
      const existing = existingNamespaces.find(n => n.id === ns.id) ?? existingNamespaces.find(n => n.title === ns.name)

      if (existing) {
        ns.id = existing.id
        console.log(`✅ existing ${ns.name} (${ns.binding}) - ID: ${ns.id}`)
      } else {
        const newNS = await client.kv.namespaces.create({
          account_id: this.accountId,
          title: ns.name
        })
        ns.id = newNS.id
        console.log(`🔧 create kv namespace ${ns.name} (${ns.binding}) - ID: ${ns.id}`)
      }
    }
  }

  generateWranglerConfig() {
    return JSON.stringify(
      {
        d1_databases: config.d1_databases.map(({ binding, name, id }) => ({ binding, database_name: name, database_id: id })),
        kv_namespaces: config.kv_namespaces.map(({ binding, id }) => ({ binding, id }))
      },
      null,
      2
    )
  }
}

async function main() {
  if (!api.accountId || (!process.env.CLOUDFLARE_API_TOKEN && (!api.email || !api.apiKey))) {
    console.error('Error: set account_id and CLOUDFLARE_API_TOKEN (or CLOUDFLARE_EMAIL/CLOUDFLARE_API_KEY)')
    process.exitCode = 1
    return
  }

  try {
    const manager = new ResourceManager(api.accountId)
    await manager.initializeAll()

    console.log('Resource IDs to copy into api.toml (other configuration is unchanged):')
    console.log(manager.generateWranglerConfig())
  } catch {
    console.error('Resource provisioning failed; check account permissions and resource names')
    process.exitCode = 1
  }
}

main().catch(() => {
  console.error('Resource provisioning failed')
  process.exitCode = 1
})
