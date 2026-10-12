import { API_ROOT } from './root'
import consumerTS from 'typescript'
import consumerPath from 'path'
import consumerFS from 'fs'

interface QueueTask {
  queueName: string
  methodName: string
  className: string
  isBatch: boolean
}

const CONTROLLER_DIR: string = 'src/handler/queue'
const OUTPUT_PATH: string = 'src/di/generated/consumer.ts'

function generateConsumer(): void {
  const rootDir: string = API_ROOT
  const controllerPath: string = consumerPath.join(rootDir, CONTROLLER_DIR)
  const queueTasks: QueueTask[] = []
  const controllerImports: Map<string, string> = new Map<string, string>()

  if (!consumerFS.existsSync(controllerPath)) {
    console.error(`Controller directory not found: ${CONTROLLER_DIR}`)
    return
  }

  console.log(`Scanning controller directory: ${CONTROLLER_DIR}`)
  scanDirectory(controllerPath, queueTasks, controllerImports)
  generateOutputFile(queueTasks, controllerImports, consumerPath.join(rootDir, OUTPUT_PATH))
}

function scanDirectory(dirPath: string, tasks: QueueTask[], imports: Map<string, string>): void {
  consumerFS.readdirSync(dirPath).forEach((file: string) => {
    const filePath: string = consumerPath.join(dirPath, file)

    if (consumerFS.statSync(filePath).isDirectory()) {
      scanDirectory(filePath, tasks, imports)
      return
    }

    if (!file.endsWith('.ts')) return
    processFiles(filePath, tasks, imports)
  })
}

function processFiles(filePath: string, tasks: QueueTask[], imports: Map<string, string>): void {
  const content: string = consumerFS.readFileSync(filePath, 'utf-8')
  const sourceFile = consumerTS.createSourceFile(consumerPath.basename(filePath), content, consumerTS.ScriptTarget.Latest, true)

  let currentClass: string = ''

  function visit(node: any): void {
    if (consumerTS.isClassDeclaration(node) && node.name) {
      currentClass = node.name.getText(sourceFile)
      const fileName = consumerPath.basename(filePath, '.ts')
      imports.set(currentClass, fileName)
    }

    if (consumerTS.isMethodDeclaration(node) && currentClass) {
      const decorators = consumerTS.getDecorators?.(node)
      if (decorators && decorators.length > 0) {
        decorators.forEach((decorator: any) => {
          if (!consumerTS.isDecorator(decorator)) return

          const expression = decorator.expression
          if (consumerTS.isCallExpression(expression)) {
            const decoratorName: string = expression.expression.getText(sourceFile)

            if (decoratorName === 'Consumer' && expression.arguments.length > 0) {
              const queueExpr = expression.arguments[0]
              let channelValue = ''
              let isBatch = false

              //@ts-ignore
              queueExpr.properties.forEach((prop: any) => {
                if (consumerTS.isPropertyAssignment(prop)) {
                  const propName = prop.name.getText(sourceFile)

                  if (propName === 'channel') {
                    channelValue = prop.initializer.getText(sourceFile).replace(/['"]/g, '')
                  } else if (propName === 'batch') {
                    isBatch = prop.initializer.getText(sourceFile) === 'true'
                  }
                }
              })
              if (node.name) {
                tasks.push({
                  queueName: channelValue,
                  methodName: node.name.getText(sourceFile),
                  className: currentClass,
                  isBatch: isBatch
                })
              }
            }
          }
        })
      }
    }

    consumerTS.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function generateOutputFile(tasks: QueueTask[], imports: Map<string, string>, outputPath: string): void {
  const output: string = `import { queueChannel } from '../../utils/queueChannel'
import { Container } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
${Array.from(imports.entries())
  .map(entry => `import { ${entry[0]} } from '../../handler/queue/${entry[1]}'`)
  .join('\n')}

const handleMessages = async (exec: ExecutionContext, env: Env, messages: readonly Message[], processFunction: (ctx: ContextManager, body: any) => Promise<void>) => {
  for (const item of messages) {
    const param = { id: item.id, info: item.body }
    const ctx = new ContextManager(exec, env)
    await processFunction(ctx, param)
    item.ack()
  }
}

const handleBatchMessages = async (exec: ExecutionContext, env: Env, messages: readonly Message[], processFunction: (ctx: ContextManager, body: any) => Promise<void>) => {
  const processParams = []
  for (const item of messages) {
    const param = { id: item.id, info: item.body }
    processParams.push(param)
  }
  await processFunction(new ContextManager(exec, env), processParams)
  for (const item of messages) {
    item.ack()
  }
}

export const handleMessage = async (container: Container, batch: MessageBatch, env: Env, exec: ExecutionContext) => {
  switch (queueChannel(batch.queue, env.API_QUEUE_CHANNELS)) {
    ${tasks
      .map(
        task => `case '${task.queueName}': {
      const consumer = container.resolve(${task.className})
      ${task.isBatch ? `await handleBatchMessages(exec, env, batch.messages, consumer.${task.methodName}.bind(consumer))` : `await handleMessages(exec, env, batch.messages, consumer.${task.methodName}.bind(consumer))`}
      break
    }`
      )
      .join('\n    ')}
    default:
      throw new Error(\`Unknown queue: \${batch.queue}\`)
  }

  console.log(\`handle \${batch.queue} \${batch.messages.length} messages\`)
}
`

  const outputDir: string = consumerPath.dirname(outputPath)
  if (!consumerFS.existsSync(outputDir)) {
    consumerFS.mkdirSync(outputDir, { recursive: true })
  }

  consumerFS.writeFileSync(outputPath, output)
  console.log(`✅ Generated consumer file: ${outputPath}`)
}

generateConsumer()
