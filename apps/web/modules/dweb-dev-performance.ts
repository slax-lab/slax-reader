import { build as buildUno } from '@unocss/cli'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineNuxtModule } from 'nuxt/kit'

const CACHE_SCHEMA = 1
const SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.less', '.md', '.mdc', '.mjs', '.sass', '.scss', '.styl', '.ts', '.tsx', '.vue'])
const UNO_DEPENDENCIES = [
  'unocss',
  '@unocss/cli',
  '@unocss/nuxt',
  '@unocss/preset-attributify',
  '@unocss/preset-icons',
  '@unocss/preset-rem-to-px',
  '@unocss/transformer-directives',
  '@iconify-json/ic',
  '@iconify-json/logos',
  '@iconify-json/solar',
  '@iconify-json/svg-spinners'
]
const DEFAULT_CLIENT_WARMUP_FILES = [
  'plugins/powersync.client.ts',
  'plugins/dashboard-metric.client.ts',
  'plugins/local-first-adapters.client.ts',
  'pages/login.vue',
  'pages/bookmarks/index.vue',
  'pages/bookmarks/[id].vue',
  'pages/b/[id].vue',
  'pages/guide.vue',
  'pages/user.vue',
  'pages/auth.vue'
]

interface DwebDevPerformanceOptions {
  enabled?: boolean
  cache?: boolean
  warmRoutes?: string[]
  clientWarmupFiles?: string[]
}

interface CacheManifest {
  schema: number
  fingerprint: string
  unocssVersion: string
  inputCount: number
  generatedAt: string
}

const pathFromModule = fileURLToPath(import.meta.url)

const collectFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async entry => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return collectFiles(path)
      return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : []
    })
  )
  return files.flat()
}

const existingPaths = (paths: string[]) => [...new Set(paths.filter(existsSync))]

const getProjectPaths = (nuxt: { options: { rootDir: string; workspaceDir: string; _layers: readonly { config: { rootDir: string } }[] } }) => {
  const projectRoot = nuxt.options.rootDir
  const layerRoots = nuxt.options._layers.map(layer => layer.config.rootDir)
  const roots = [...new Set([projectRoot, ...layerRoots])]
  const configFiles = new Set<string>()

  for (const root of roots) {
    let current = root
    while (current.startsWith(nuxt.options.workspaceDir)) {
      configFiles.add(resolve(current, 'uno.config.ts'))
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  const sourceDirs = existingPaths(roots.flatMap(root => [resolve(root, 'app'), resolve(root, 'styles')]))
  const appDirs = existingPaths(roots.map(root => resolve(root, 'app')))

  return {
    projectRoot,
    configFiles: [...configFiles].filter(existsSync).sort(),
    sourceDirs,
    appDirs
  }
}

const resolvePackageJson = (requireFromProject: NodeRequire, name: string) => {
  try {
    return requireFromProject.resolve(`${name}/package.json`)
  } catch {
    return createRequire(pathFromModule).resolve(`${name}/package.json`)
  }
}

const readPackageVersion = async (requireFromProject: NodeRequire, name: string) => {
  const packageJson = JSON.parse(await readFile(resolvePackageJson(requireFromProject, name), 'utf8')) as { version?: string }
  if (!packageJson.version) throw new Error(`Unable to resolve ${name} version for UnoCSS cache fingerprint`)
  return packageJson.version
}

const createFingerprint = async (nuxt: Parameters<typeof getProjectPaths>[0], paths: ReturnType<typeof getProjectPaths>) => {
  const sourceFiles = (await Promise.all(paths.sourceDirs.map(collectFiles))).flat()
  const inputFiles = [...paths.configFiles, ...sourceFiles, pathFromModule].sort()
  const hash = createHash('sha256')
  hash.update(`dweb-uno-cache-schema:${CACHE_SCHEMA}\0`)

  for (const path of inputFiles) {
    hash.update(relative(paths.projectRoot, path))
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }

  const requireFromProject = createRequire(resolve(paths.projectRoot, 'package.json'))
  const versions = new Map<string, string>()
  for (const name of UNO_DEPENDENCIES) {
    const version = await readPackageVersion(requireFromProject, name)
    versions.set(name, version)
    hash.update(`${name}@${version}\0`)
  }

  return {
    fingerprint: hash.digest('hex'),
    inputCount: inputFiles.length,
    unocssVersion: versions.get('unocss')!
  }
}

const ensureUnoCache = async (nuxt: Parameters<typeof getProjectPaths>[0]) => {
  const paths = getProjectPaths(nuxt)
  const cacheDir = resolve(paths.projectRoot, '.cache/unocss')
  const cacheCssPath = resolve(cacheDir, 'uno.css')
  const manifestPath = resolve(cacheDir, 'manifest.json')
  const current = await createFingerprint(nuxt, paths)
  let manifest: CacheManifest | undefined

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CacheManifest
  } catch {
    manifest = undefined
  }

  if (existsSync(cacheCssPath) && manifest?.schema === CACHE_SCHEMA && manifest.fingerprint === current.fingerprint) {
    console.log(`[dweb-uno-cache] hit (${current.inputCount} inputs)`)
    return { ...paths, cacheCssPath, cacheDir, manifestPath, cacheAvailable: true }
  }

  const startedAt = performance.now()
  await mkdir(cacheDir, { recursive: true })
  const cssTempPath = `${cacheCssPath}.${process.pid}.tmp`
  const manifestTempPath = `${manifestPath}.${process.pid}.tmp`
  const patterns = paths.appDirs.map(directory => `${relative(paths.projectRoot, directory)}/**/*.{vue,html,md,mdc,js,jsx,ts,tsx,mjs,cjs}`)

  await buildUno({
    cwd: paths.projectRoot,
    config: resolve(paths.projectRoot, 'uno.config.ts'),
    patterns,
    outFile: cssTempPath,
    preflights: false,
    minify: false,
    splitCss: false
  })

  const cssStats = await stat(cssTempPath)
  if (cssStats.size === 0) throw new Error('UnoCSS generated an empty dweb cache')

  const nextManifest: CacheManifest = {
    schema: CACHE_SCHEMA,
    fingerprint: current.fingerprint,
    unocssVersion: current.unocssVersion,
    inputCount: current.inputCount,
    generatedAt: new Date().toISOString()
  }

  await rename(cssTempPath, cacheCssPath)
  await writeFile(manifestTempPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8')
  await rename(manifestTempPath, manifestPath)
  console.log(`[dweb-uno-cache] generated ${(cssStats.size / 1024).toFixed(1)} KiB (${Math.round(performance.now() - startedAt)}ms, ${current.inputCount} inputs)`)

  return { ...paths, cacheCssPath, cacheDir, manifestPath, cacheAvailable: true }
}

const resolveClientWarmupFiles = (nuxt: Parameters<typeof getProjectPaths>[0], paths: ReturnType<typeof getProjectPaths>, configured: string[]) => {
  if (configured.length > 0) {
    return existingPaths(configured.map(path => (path.startsWith('/') ? path : resolve(paths.projectRoot, path))))
  }
  return existingPaths(paths.appDirs.flatMap(appDir => DEFAULT_CLIENT_WARMUP_FILES.map(path => resolve(appDir, path))))
}

export default defineNuxtModule<DwebDevPerformanceOptions>({
  meta: {
    name: 'dweb-dev-performance',
    configKey: 'dwebDevPerformance'
  },
  defaults: {
    enabled: true,
    cache: true,
    warmRoutes: ['/bookmarks', '/login', '/guide'],
    clientWarmupFiles: []
  },
  async setup(options, nuxt) {
    if (!nuxt.options.dev || options.enabled === false) return

    const paths = getProjectPaths(nuxt)
    let cacheCssPath: string | undefined
    if (options.cache !== false) {
      try {
        const cache = await ensureUnoCache(nuxt)
        cacheCssPath = cache.cacheAvailable ? cache.cacheCssPath : undefined
      } catch (error) {
        console.warn('[dweb-uno-cache] generation failed; falling back to virtual uno.css', error)
      }
    }

    if (cacheCssPath) {
      nuxt.options.css = [...nuxt.options.css, cacheCssPath]
      nuxt.options.unocss = {
        ...(nuxt.options.unocss || {}),
        autoImport: false
      }
    }

    const clientWarmupFiles = resolveClientWarmupFiles(nuxt, paths, options.clientWarmupFiles || [])
    const startedAt = performance.now()
    let warmBase: string | undefined
    let nitroCompiled = false
    let warmStarted = false
    let unoWarmPromise: Promise<void> | undefined
    let unoWarmAttempts = 0
    let cacheRefreshTimer: ReturnType<typeof setTimeout> | undefined
    let cacheGeneration: Promise<void> | undefined
    let cacheRefreshPending = false

    const elapsed = (from = startedAt) => `${Math.round(performance.now() - from)}ms`
    const warmUrl = async (path: string): Promise<boolean> => {
      if (!warmBase) return false
      const requestStartedAt = performance.now()
      try {
        const response = await fetch(new URL(path, warmBase))
        await response.arrayBuffer()
        console.log(`[dev-warm] ${path} -> ${response.status} (${elapsed(requestStartedAt)})`)
        return response.ok
      } catch (error) {
        console.warn(`[dev-warm] ${path} failed (${elapsed(requestStartedAt)})`, error)
        return false
      }
    }
    const warmUno = () => {
      if (!warmBase || unoWarmPromise) return
      if (cacheCssPath) {
        unoWarmPromise = Promise.resolve()
        return
      }
      unoWarmAttempts++
      console.log(`[dev-warm] UnoCSS warmup started (+${elapsed()})`)
      unoWarmPromise = warmUrl('/__uno.css').then(ok => {
        if (ok) {
          console.log(`[dev-warm] UnoCSS ready (+${elapsed()})`)
          return
        }
        unoWarmPromise = undefined
        if (nitroCompiled && unoWarmAttempts < 2) warmUno()
      })
    }
    const warmRoutes = async () => {
      if (!nitroCompiled || !warmBase || warmStarted) return
      warmStarted = true
      console.log(`[dev-warm] HTTP warmup started at ${warmBase} (+${elapsed()})`)
      await Promise.all((options.warmRoutes || []).map(warmUrl))
      console.log(`[dev-warm] critical routes ready (+${elapsed()})`)
      await unoWarmPromise
      console.log(`[dev-warm] ready (+${elapsed()})`)
    }
    const scheduleCacheRefresh = (changedPath: string) => {
      if (changedPath.includes('.cache/unocss')) return
      clearTimeout(cacheRefreshTimer)
      cacheRefreshTimer = setTimeout(() => {
        if (cacheGeneration) {
          cacheRefreshPending = true
          return
        }
        cacheGeneration = ensureUnoCache(nuxt)
          .then(() => undefined)
          .catch(error => console.warn('[dweb-uno-cache] refresh failed', error))
          .finally(() => {
            cacheGeneration = undefined
            if (cacheRefreshPending) {
              cacheRefreshPending = false
              scheduleCacheRefresh(changedPath)
            }
          })
      }, 250)
    }

    nuxt.hook('vite:extendConfig', config => {
      if (!clientWarmupFiles.length) return
      const server = config.server || {}
      Object.assign(config, { server })
      server.warmup = {
        ...(server.warmup || {}),
        clientFiles: clientWarmupFiles
      }
    })
    nuxt.hook('listen', (_server, listener: { url?: string }) => {
      warmBase = listener.url || 'http://localhost:3000/'
      console.log(`[dev-warm] listener ready at ${warmBase} (+${elapsed()})`)
      warmUno()
      void warmRoutes()
    })
    nuxt.hook('builder:watch', (_event, changedPath) => {
      scheduleCacheRefresh(changedPath)
    })
    nuxt.hook('close', () => {
      clearTimeout(cacheRefreshTimer)
    })

    nuxt.hook('nitro:init', nitro => {
      nitro.hooks.hook('compiled', () => {
        nitroCompiled = true
        console.log(`[dev-warm] Nitro compiled (+${elapsed()})`)
        warmUno()
        void warmRoutes()
      })
    })
  }
})
