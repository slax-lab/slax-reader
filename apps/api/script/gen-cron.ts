import { API_ROOT } from './root'
import cronGenTS from 'typescript'
import cronGenPath from 'path'
import cronGenFS from 'fs'

interface CronGenTask {
  expression: string
  methodName: string
  className: string
}

const CRONGEN_CONTROLLER_DIR: string = 'src/handler/cron'
const CRONGEN_OUTPUT_PATH: string = 'src/di/generated/cronjob.ts'

function cronGenStart(): void {
  const cronGenRoot: string = API_ROOT
  const cronGenControllerPath: string = cronGenPath.join(cronGenRoot, CRONGEN_CONTROLLER_DIR)
  const cronGenTasks: CronGenTask[] = []
  const cronGenImports: Map<string, string> = new Map<string, string>()

  if (!cronGenFS.existsSync(cronGenControllerPath)) {
    console.error(`Controller directory not found: ${CRONGEN_CONTROLLER_DIR}`)
    return
  }

  console.log(`Scanning controller directory: ${CRONGEN_CONTROLLER_DIR}`)
  cronGenScanDir(cronGenControllerPath, cronGenTasks, cronGenImports)
  cronGenCreateOutput(cronGenTasks, cronGenImports, cronGenPath.join(cronGenRoot, CRONGEN_OUTPUT_PATH), cronGenRoot)
}

function cronGenScanDir(dirPath: string, tasks: CronGenTask[], imports: Map<string, string>): void {
  cronGenFS.readdirSync(dirPath).forEach((file: string) => {
    const cronGenFilePath: string = cronGenPath.join(dirPath, file)

    if (cronGenFS.statSync(cronGenFilePath).isDirectory()) {
      cronGenScanDir(cronGenFilePath, tasks, imports)
      return
    }

    if (!file.endsWith('.ts')) return
    cronGenProcessFile(cronGenFilePath, tasks, imports, dirPath)
  })
}

function cronGenProcessFile(filePath: string, tasks: CronGenTask[], imports: Map<string, string>, dirPath: string): void {
  const cronGenContent: string = cronGenFS.readFileSync(filePath, 'utf-8')
  const cronGenSource = cronGenTS.createSourceFile(cronGenPath.basename(filePath), cronGenContent, cronGenTS.ScriptTarget.Latest, true)

  let cronGenCurrentClass: string = ''

  function cronGenVisit(node: any): void {
    if (cronGenTS.isClassDeclaration(node) && node.name) {
      cronGenCurrentClass = node.name.getText(cronGenSource)
      const relativePath = cronGenPath.relative(cronGenPath.join(API_ROOT, CRONGEN_CONTROLLER_DIR), filePath)
      const importPath = cronGenPath.join(cronGenPath.dirname(relativePath), cronGenPath.basename(filePath, '.ts')).replace(/\\/g, '/')
      imports.set(cronGenCurrentClass, importPath)
    }

    if (cronGenTS.isMethodDeclaration(node) && cronGenCurrentClass) {
      const decorators = cronGenTS.getDecorators?.(node)
      if (decorators && decorators.length > 0) {
        decorators.forEach((decorator: any) => {
          if (!cronGenTS.isDecorator(decorator)) return

          const expression = decorator.expression
          if (cronGenTS.isCallExpression(expression)) {
            const decoratorName: string = expression.expression.getText(cronGenSource)

            if ((decoratorName === 'Scheduled' || decoratorName === 'Cron') && expression.arguments.length > 0) {
              const cronExpression: string = cronGenEvalExpression(expression.arguments[0], cronGenSource)
              if (node.name) {
                tasks.push({
                  expression: cronExpression,
                  methodName: node.name.getText(cronGenSource),
                  className: cronGenCurrentClass
                })
              }
            }
          }
        })
      }
    }

    cronGenTS.forEachChild(node, cronGenVisit)
  }

  cronGenVisit(cronGenSource)
}

function cronGenEvalExpression(expression: any, sourceFile: any): string {
  if (cronGenTS.isStringLiteral(expression)) {
    return expression.text
  }

  if (cronGenTS.isTemplateExpression(expression)) {
    return expression.getText(sourceFile).slice(1, -1)
  }

  try {
    const expressionText: string = expression.getText(sourceFile)
    return expressionText.replace(/['"]/g, '')
  } catch (error) {
    console.error('Failed to evaluate cron expression:', error)
    return ''
  }
}

function cronGenCreateOutput(tasks: CronGenTask[], imports: Map<string, string>, outputPath: string, rootDir: string): void {
  const cronGenOutput: string = `import { Container } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
${Array.from(imports.entries())
  .map(entry => {
    const className: string = entry[0]
    const fileName: string = entry[1]
    return `import { ${className} } from '../../handler/cron/${fileName}'`
  })
  .join('\n')}

export const handleCronjob = async (container: Container, event: any, env: Env, exec: ExecutionContext) => {
  ${tasks
    .map(
      (task: CronGenTask) => `const ${task.methodName} = async () => {
    const controller = container.resolve(${task.className})
    exec.waitUntil(controller.${task.methodName}(new ContextManager(exec, env)))
  }`
    )
    .join('\n  ')}

  const cronTasks: Array<[string, () => Promise<void>]> = [
    ${tasks.map(task => `['${task.expression}', ${task.methodName}]`).join(',\n    ')}
  ]

  const matching = cronTasks.filter(([expression]) => expression === event.cron)
  if (matching.length === 0) {
    console.log(\`\${event.scheduledTime} cron \${event.cron} not found\`)
    return
  }
  for (const [, handler] of matching) exec.waitUntil(Promise.resolve().then(handler))
}
`

  const cronGenOutputDir: string = cronGenPath.dirname(outputPath)
  if (!cronGenFS.existsSync(cronGenOutputDir)) {
    cronGenFS.mkdirSync(cronGenOutputDir, { recursive: true })
  }

  cronGenFS.writeFileSync(outputPath, cronGenOutput)
  console.log(`✅ Generated cron job file: ${outputPath}`)
}

cronGenStart()
