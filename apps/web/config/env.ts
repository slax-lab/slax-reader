import { dwebEnvSchema, extensionsEnvSchema } from '../env.schema'
import dotenv from 'dotenv'
import fs from 'fs'
import { fileURLToPath } from 'node:url'
;(() => {
  console.log('加载环境变量文件...')
  const env = process.env.SLAX_ENV || 'development'
  const envFiles = ['.env', `.env.${env}`, `.env.${env}.local`]

  envFiles.forEach(file => {
    const envPath = fileURLToPath(new URL(`../${file}`, import.meta.url))

    if (fs.existsSync(envPath)) {
      const envConfig = dotenv.config({ path: envPath })

      if (envConfig.error) {
        console.warn(`加载环境变量文件失败：${file}:`, envConfig.error)
      } else {
        console.log(`已加载环境变量文件：${file}`)
      }
    }
  })
})()

type EnvTypes = 'production' | 'beta' | 'preview' | 'development'

export const getEnv: () => EnvTypes = () => {
  const env = process.env.SLAX_ENV || 'development'
  return env as EnvTypes
}

export const getExtensionsConfig = () => {
  const env = process.env
  const envObject = Object.keys(extensionsEnvSchema.shape).reduce(
    (acc, key) => {
      acc[key] = env[key]
      return acc
    },
    {} as Record<string, unknown>
  )

  const result = extensionsEnvSchema.safeParse(envObject)

  if (!result.success) {
    const errorMessages = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')
    console.warn(`插件环境变量部分解析失败：\n${errorMessages}`)
    const partialData: Record<string, unknown> = {}
    const problematicPaths = new Set(result.error.issues.map(issue => issue.path[0]?.toString()))
    for (const key of Object.keys(extensionsEnvSchema.shape)) {
      if (!problematicPaths.has(key) && envObject[key] !== undefined) {
        partialData[key] = envObject[key]
      }
    }

    return partialData
  }

  return result.data
}

export const getDWebConfig = () => {
  const env = process.env

  const envObject = Object.keys(dwebEnvSchema.shape).reduce(
    (acc, key) => {
      acc[key] = env[key]
      return acc
    },
    {} as Record<string, unknown>
  )

  const result = dwebEnvSchema.safeParse(envObject)

  if (!result.success) {
    const errorMessages = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')
    console.warn(`网页环境变量部分解析失败：\n${errorMessages}`)
    const partialData: Record<string, unknown> = {}
    const problematicPaths = new Set(result.error.issues.map(issue => issue.path[0]?.toString()))
    for (const key of Object.keys(dwebEnvSchema.shape)) {
      if (!problematicPaths.has(key) && envObject[key] !== undefined) {
        partialData[key] = envObject[key]
      }
    }

    return partialData
  }

  return result.data
}
