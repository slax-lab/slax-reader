import { API_ROOT } from './root'
import ts from 'typescript'
import pathUtils from 'path'
import fsUtils from 'fs'

interface RouteConfig {
  controllers: string[]
  outputFile: string
}

interface ControllerInfo {
  name: string
  path: string
  basePath: string
}

interface RouteInfo {
  method: string
  path: string
  handlerName: string
  controllerName: string
}

const DEFAULT_CONTROLLER_DIR: string = 'src/handler/http'

const routeConfigurations: RouteConfig[] = [
  {
    controllers: [
      'src/handler/http/aigcController.ts',
      'src/handler/http/bookmarkController.ts',
      'src/handler/http/callbackController.ts',
      'src/handler/http/collectionController.ts',
      'src/handler/http/markController.ts',
      'src/handler/http/shareController.ts',
      'src/handler/http/subscriptionController.ts',
      'src/handler/http/tagController.ts',
      'src/handler/http/userController.ts',
      'src/handler/http/mcpController.ts',
      'src/handler/http/syncController.ts',
      'src/handler/http/promotionController.ts',
      'src/handler/http/apiKeyController.ts',
      'src/handler/http/eventsController.ts',
      'src/handler/http/metricsController.ts'
    ],
    outputFile: 'src/di/generated/readerRouter.ts'
  }
]

function generateRoutes(): void {
  const projectRoot: string = API_ROOT

  routeConfigurations.forEach((config: RouteConfig) => {
    generateRouteRegistration(config, projectRoot)
  })
}

function generateRouteRegistration(config: RouteConfig, projectRoot: string): void {
  const outputFile: string = pathUtils.join(projectRoot, config.outputFile)
  const routes: RouteInfo[] = []
  const controllerImports: Map<string, string> = new Map<string, string>()
  if (!config.controllers || config.controllers.length === 0) {
    const controllerDir: string = pathUtils.join(projectRoot, DEFAULT_CONTROLLER_DIR)

    if (!fsUtils.existsSync(controllerDir)) {
      console.error(`Controller directory not found: ${DEFAULT_CONTROLLER_DIR}`)
      return
    }

    console.log(`Scanning controller directory: ${DEFAULT_CONTROLLER_DIR}`)
    scanDirectoryController(controllerDir, routes, controllerImports, DEFAULT_CONTROLLER_DIR)
  } else {
    config.controllers.forEach((controllerPath: string) => {
      const absolutePath: string = pathUtils.join(projectRoot, controllerPath)
      if (!fsUtils.existsSync(absolutePath)) {
        console.error(`Controller file not found: ${controllerPath}`)
        return
      }

      const dirRelativePath: string = pathUtils.dirname(controllerPath)
      processFile(absolutePath, routes, controllerImports, dirRelativePath)
    })
  }

  generateOutput(routes, controllerImports, outputFile, projectRoot, DEFAULT_CONTROLLER_DIR)
}

function scanDirectoryController(dir: string, routes: RouteInfo[], controllerImports: Map<string, string>, baseDirPath: string): void {
  fsUtils.readdirSync(dir).forEach((file: string) => {
    const filePath: string = pathUtils.join(dir, file)

    if (fsUtils.statSync(filePath).isDirectory()) {
      scanDirectoryController(filePath, routes, controllerImports, baseDirPath)
      return
    }

    if (!file.endsWith('.ts')) return

    processFile(filePath, routes, controllerImports, baseDirPath)
  })
}

function processFile(filePath: string, routes: RouteInfo[], controllerImports: Map<string, string>, baseDirPath: string): void {
  const fileName: string = pathUtils.basename(filePath).replace(/\.ts$/, '')
  const sourceText: string = fsUtils.readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(pathUtils.basename(filePath), sourceText, ts.ScriptTarget.Latest, true)

  let currentController: ControllerInfo = {
    name: '',
    path: '',
    basePath: ''
  }

  function visit(node: any): void {
    if (ts.isClassDeclaration(node)) {
      const decorators = ts.getDecorators?.(node)
      if (decorators && decorators.length > 0 && node.name) {
        currentController = {
          name: node.name.getText(sourceFile),
          path: '',
          basePath: ''
        }

        decorators.forEach((decorator: any) => {
          if (!ts.isDecorator(decorator)) return

          const expression = decorator.expression
          if (ts.isCallExpression(expression)) {
            const decoratorName: string = expression.expression.getText(sourceFile)

            if (decoratorName === 'Controller' && expression.arguments.length > 0) {
              currentController.path = evaluateExpression(expression.arguments[0], sourceFile)

              const relativePath: string = pathUtils
                .join(pathUtils.relative(pathUtils.join(API_ROOT, DEFAULT_CONTROLLER_DIR), pathUtils.resolve(API_ROOT, baseDirPath)), fileName)
                .replace(/\\/g, '/')
              controllerImports.set(currentController.name, relativePath)
            } else if (decoratorName === 'BasePath' && expression.arguments.length > 0) {
              currentController.basePath = evaluateExpression(expression.arguments[0], sourceFile)
            }
          }
        })
      }
    }

    if (ts.isMethodDeclaration(node) && currentController.name) {
      const decorators = ts.getDecorators?.(node)
      if (decorators && decorators.length > 0) {
        decorators.forEach((decorator: any) => {
          if (!ts.isDecorator(decorator)) return

          const expression = decorator.expression
          if (ts.isCallExpression(expression)) {
            const decoratorName: string = expression.expression.getText(sourceFile)
            const methodMatch = decoratorName.match(/^(Get|Post|Put|Delete|All)/i)

            if (methodMatch && expression.arguments.length > 0) {
              const method: string = methodMatch[0].toLowerCase()
              let routePath: string = evaluateExpression(expression.arguments[0], sourceFile)

              const fullPath: string = normalizePath(`${currentController.path || ''}${currentController.basePath || ''}${routePath}`)

              if (node.name) {
                routes.push({
                  method,
                  path: fullPath,
                  handlerName: node.name.getText(sourceFile),
                  controllerName: currentController.name
                })
              }
            }
          }
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function evaluateExpression(expression: any, sourceFile: any): string {
  if (ts.isStringLiteral(expression)) {
    return expression.text
  }

  if (ts.isTemplateExpression(expression)) {
    return expression.getText(sourceFile).slice(1, -1)
  }

  try {
    const expressionText: string = expression.getText(sourceFile)
    if (expressionText.includes('+') || expressionText.includes('`')) {
      return eval(expressionText)
    }
    return expressionText
  } catch (error) {
    console.error('Failed to evaluate expression:', error)
    return ''
  }
}

function normalizePath(path: string): string {
  const normalized: string = path.replace(/\/+/g, '/')
  return normalized.startsWith('/') ? normalized : '/' + normalized
}

function generateOutput(routes: RouteInfo[], controllerImports: Map<string, string>, outputFile: string, projectRoot: string, baseDirPath: string): void {
  const controllersToImportPath: string = pathUtils.relative(pathUtils.dirname(outputFile), pathUtils.join(projectRoot, baseDirPath)).replace(/\\/g, '/')

  const routeRegistrationCode: string = `import { Router } from 'itty-router'
import { auth } from '../../middleware/auth'
import { requestLog } from '../../middleware/requestLog'
import { cors } from '../../middleware/cors'
import { rateLimit } from '../../middleware/rateLimit'
import { ContextManager } from '@/utils/context'
import { Container } from '../../decorators/di'
import { NotFound, Successed } from '../../utils/responseUtils'
${Array.from(controllerImports.entries())
  .map(entry => {
    const className: string = entry[0]
    const fileName: string = entry[1]
    return `import { ${className} } from '${controllersToImportPath}/${fileName}'`
  })
  .join('\n')}

export function getRouter(container: Container) {
  const router = Router()

  router.all('*', cors)
  router.all('*', (req: Request, ctx: ContextManager) => auth(req, ctx, container))
  router.all('*', (req: Request, ctx: ContextManager) => requestLog(req, ctx))
  router.all('*', (req: Request, ctx: ContextManager) => rateLimit(req, ctx))

${routes
  .map(
    (route: RouteInfo) => ` router.${route.method}('${route.path}', async (req: Request, ctx: ContextManager) => {
  const controller = container.resolve(${route.controllerName})
  return await controller.${route.handlerName}(ctx, req)
})`
  )
  .join('\n')}


  router.get('/ping', () => Successed('pong'))
  router.all('*', () => NotFound('Resource not found'))

  return router
}
`

  const outputDir: string = pathUtils.dirname(outputFile)
  if (!fsUtils.existsSync(outputDir)) {
    fsUtils.mkdirSync(outputDir, { recursive: true })
  }

  fsUtils.writeFileSync(outputFile, routeRegistrationCode)
  console.log(`✅ Generated route file: ${outputFile}`)
}

generateRoutes()
