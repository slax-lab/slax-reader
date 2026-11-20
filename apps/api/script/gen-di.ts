import { API_ROOT, API_TSCONFIG } from './root'
import fs from 'fs'
import path from 'path'

import { Project, SyntaxKind } from 'ts-morph'

const GENERATED_DIR = path.resolve(API_ROOT, 'src/di/generated')
const PROVIDERS_DIR = path.resolve(API_ROOT, 'src/di/providers')

// Each Worker tier registers only the classes reachable from its own roots: the controllers, consumers
// and cron jobs in its generated dispatch files, plus classes its entry files resolve directly.
const TIERS = {
  core: {
    dispatch: ['core/readerRouter.ts', 'core/consumer.ts', 'core/cronjob.ts'],
    entries: ['src/entry/core']
  },
  ai: {
    dispatch: ['ai/aiRouter.ts'],
    entries: ['src/entry/ai']
  }
} as const
type Tier = keyof typeof TIERS

interface ServiceTypeInfo {
  className: string
  sourceFilePath: string
  requiresEnv: boolean
  isController: boolean
  isRegistry: boolean
  isService: boolean
  isRepository: boolean
  dependencies: DependencyInfo[]
}

interface DependencyInfo {
  paramName: string
  typeName: string
  sourcePath?: string
  isLazy: boolean
  injectionToken?: string
}

class DIGenerator {
  private project: any
  private imports = new Map<string, Set<string>>()
  private registrations = new Set<string>()
  private symbolImports = new Set<string>()
  private scannedClasses = new Map<string, any>()
  private serviceInfoMap = new Map<string, ServiceTypeInfo>()
  private symbolUsages = new Map<string, Set<string>>()
  private registeredTypes = new Set<string>()
  private registrationOf = new Map<string, string>()

  private readonly CONFIG = {
    decorators: {
      controller: ['Controller', 'Scheduled', 'Consumer'],
      injectable: ['injectable', 'singleton']
    }
  }

  constructor() {
    this.project = new Project({
      tsConfigFilePath: API_TSCONFIG
    })
  }

  generate() {
    this.scanAllClasses()
    this.scanSymbols()
    this.analyzeClassDependencies()
    this.generateRegistrations()
    for (const tier of Object.keys(TIERS) as Tier[]) this.generateTier(tier)
  }

  private resolvedNames(files: string[]): Set<string> {
    const names = new Set<string>()
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\.resolve(?:<[^>]*>)?\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)) names.add(match[1])
    }
    return names
  }

  private tierFiles(tier: Tier): string[] {
    const files: string[] = []
    const walk = (target: string) => {
      const absolute = path.resolve(API_ROOT, target)
      if (!fs.existsSync(absolute)) return
      if (fs.statSync(absolute).isDirectory()) for (const child of fs.readdirSync(absolute)) walk(path.join(target, child))
      else if (absolute.endsWith('.ts')) files.push(absolute)
    }
    for (const entry of TIERS[tier].entries) walk(entry)
    for (const dispatch of TIERS[tier].dispatch) files.push(path.join(GENERATED_DIR, dispatch))
    return files
  }

  private closure(tier: Tier): { classes: Set<string>; tokens: Set<string> } {
    const classes = new Set<string>()
    const tokens = new Set<string>()
    const pending = Array.from(this.resolvedNames(this.tierFiles(tier)))
    while (pending.length) {
      const name = pending.pop()!
      if (classes.has(name) || tokens.has(name)) continue
      const info = this.serviceInfoMap.get(name)
      // Infrastructure clients are classes too, but each request scope must bind them to its env through their provider.
      if (fs.existsSync(path.join(PROVIDERS_DIR, `${name}.ts`))) tokens.add(name)
      if (!info) {
        tokens.add(name)
        continue
      }
      classes.add(name)
      for (const dep of info.dependencies) pending.push(dep.typeName)
    }
    return { classes, tokens }
  }

  private shouldSkipFile(filePath: string): boolean {
    return !filePath.startsWith(path.resolve(API_ROOT, 'src') + path.sep)
  }

  private scanAllClasses() {
    const sourceFiles = this.project.getSourceFiles()

    sourceFiles.forEach((sourceFile: any) => {
      const filePath = sourceFile.getFilePath()
      if (this.shouldSkipFile(filePath)) {
        return
      }

      sourceFile.getClasses().forEach((cls: any) => {
        const className = cls.getName()
        if (!className) return

        const decorators = cls.getDecorators()
        if (decorators.length === 0) return

        this.scannedClasses.set(className, cls)

        const serviceInfo: ServiceTypeInfo = {
          className,
          sourceFilePath: sourceFile.getFilePath(),
          requiresEnv: this.classRequiresEnv(cls),
          isController: false,
          isRegistry: false,
          isService: false,
          isRepository: false,
          dependencies: []
        }

        this.determineClassTypeByDecorators(cls, serviceInfo)

        if (serviceInfo.isController || serviceInfo.isService || serviceInfo.isRepository || serviceInfo.isRegistry) {
          this.serviceInfoMap.set(className, serviceInfo)
        }
      })
    })
  }

  private determineClassTypeByDecorators(cls: any, serviceInfo: ServiceTypeInfo) {
    const decorators = cls.getDecorators()

    for (const decorator of decorators) {
      const name = decorator.getName()

      if (this.CONFIG.decorators.controller.includes(name)) {
        serviceInfo.isController = true
        serviceInfo.isService = true
        return
      }
    }

    const isInjectable = decorators.some((d: any) => this.CONFIG.decorators.injectable.includes(d.getName()))

    if (isInjectable) {
      if (cls.getMethod('register') !== undefined) {
        serviceInfo.isRegistry = true
      } else {
        serviceInfo.isService = true
      }
    }
  }

  private scanSymbols() {
    const symbolFiles = this.project.getSourceFiles().filter((file: any) => {
      const filePath = file.getFilePath()
      if (this.shouldSkipFile(filePath)) {
        return false
      }
      return filePath.includes('/const/') || filePath.includes('/symbol') || filePath.includes('/tokens')
    })

    symbolFiles.forEach((file: any) => {
      const symbolDeclarations = file.getVariableDeclarations().filter((decl: any) => {
        const initializer = decl.getInitializer()
        if (!initializer) return false

        return initializer.getKind() === SyntaxKind.CallExpression && initializer.getExpression().getText() === 'Symbol'
      })

      if (symbolDeclarations.length > 0) {
        const importPath = this.getRelativeImportPath(file.getFilePath())
        this.symbolImports.add(importPath)

        symbolDeclarations.forEach((decl: any) => {
          const symbolName = decl.getName()
          if (!this.symbolUsages.has(importPath)) {
            this.symbolUsages.set(importPath, new Set())
          }
          this.symbolUsages.get(importPath)?.add(symbolName)
        })
      }
    })
  }

  private classRequiresEnv(cls: any): boolean {
    const constructor = cls.getConstructors()[0]
    if (!constructor) return false

    return constructor.getParameters().some((param: any) => {
      const type = param.getType()
      const typeText = type.getText()
      return typeText === 'Env'
    })
  }

  private analyzeClassDependencies() {
    for (const [className, serviceInfo] of this.serviceInfoMap.entries()) {
      const cls = this.scannedClasses.get(className)
      if (!cls) continue

      const constructor = cls.getConstructors()[0]
      if (!constructor) continue

      constructor.getParameters().forEach((param: any) => {
        const injectDecorator = param.getDecorators().find((d: any) => d.getName() === 'inject')
        let injectionToken: string | undefined

        if (injectDecorator) {
          const argument = injectDecorator.getArguments()[0]
          if (argument) {
            injectionToken = argument.getText()
            if (injectionToken && !injectionToken.startsWith('"') && !injectionToken.startsWith("'")) {
              this.findSymbolSource(injectionToken)
            }
          }
        }

        const paramName = param.getName()
        const paramType = param.getType()
        const paramTypeText = paramType.getText()

        if (paramTypeText === 'Env') return

        const isLazy = paramTypeText.includes('LazyInstance<')
        let typeName = ''

        if (isLazy) {
          const extractedType = this.extractTypeNameFromGeneric(paramTypeText)
          if (extractedType) {
            typeName = extractedType
            const typeDecl = this.findTypeDeclaration(extractedType)
            if (typeDecl) {
              this.addImport(typeDecl.sourceFilePath, extractedType)
            }
          }
        } else {
          const symbol = paramType.getSymbol()
          if (symbol) {
            typeName = symbol.getName()
            const declaration = symbol.getDeclarations()?.[0]
            const sourceFile = declaration?.getSourceFile()
            if (sourceFile) {
              this.addImport(sourceFile.getFilePath(), typeName)
            }
          } else {
            typeName = paramTypeText
          }
        }

        if (injectionToken) {
          typeName = injectionToken
        }

        if (['any', 'string', 'number', 'boolean', 'Array'].includes(typeName)) {
          return
        }

        if (this.isGenericParameter(cls, typeName)) return

        serviceInfo.dependencies.push({
          paramName,
          typeName,
          isLazy,
          injectionToken
        })

        if (!this.serviceInfoMap.has(typeName) && !injectionToken) {
          console.error(`\n❌ 错误: 类 ${className} 依赖 ${typeName}，但 ${typeName} 没有正确的装饰器`)
          console.error(`请为 ${typeName} 添加适当的装饰器 (@Controller, @injectable, @singleton) 后再运行。`)
          process.exit(1)
        }
      })
    }
  }

  private isGenericParameter(cls: any, typeName: string): boolean {
    const typeParameters = cls.getTypeParameters()
    if (!typeParameters || typeParameters.length === 0) {
      return false
    }

    return typeParameters.some((param: any) => param.getName() === typeName)
  }

  private extractTypeNameFromGeneric(typeText: string): string | null {
    const match = typeText.match(/LazyInstance<([^>]+)>/)
    if (match && match[1]) {
      return match[1].trim()
    }
    return null
  }

  private findSymbolSource(symbolName: string) {
    const sourceFiles = this.project.getSourceFiles().filter((file: any) => !this.shouldSkipFile(file.getFilePath()))
    for (const file of sourceFiles) {
      const varDecl = file.getVariableDeclaration(symbolName)
      if (varDecl) {
        const filePath = this.getRelativeImportPath(file.getFilePath())
        this.symbolImports.add(filePath)

        if (!this.symbolUsages.has(filePath)) {
          this.symbolUsages.set(filePath, new Set())
        }
        this.symbolUsages.get(filePath)?.add(symbolName)
        return
      }
    }
  }

  private findTypeDeclaration(typeName: string): { sourceFile: any; sourceFilePath: string } | null {
    const sourceFiles = this.project.getSourceFiles().filter((file: any) => !this.shouldSkipFile(file.getFilePath()))
    for (const file of sourceFiles) {
      const classDecl = file.getClass(typeName)
      if (classDecl) {
        return {
          sourceFile: file,
          sourceFilePath: file.getFilePath()
        }
      }

      const interfaceDecl = file.getInterface(typeName)
      if (interfaceDecl) {
        return {
          sourceFile: file,
          sourceFilePath: file.getFilePath()
        }
      }

      const typeAlias = file.getTypeAlias(typeName)
      if (typeAlias) {
        return {
          sourceFile: file,
          sourceFilePath: file.getFilePath()
        }
      }
    }
    return null
  }

  private generateRegistrations() {
    const controllers: Array<[string, ServiceTypeInfo]> = []
    const repositories: Array<[string, ServiceTypeInfo]> = []
    const services: Array<[string, ServiceTypeInfo]> = []
    const registries: Array<[string, ServiceTypeInfo]> = []

    for (const [className, serviceInfo] of this.serviceInfoMap.entries()) {
      if (this.registeredTypes.has(className)) continue

      if (serviceInfo.isController) {
        controllers.push([className, serviceInfo])
      } else if (serviceInfo.isRepository) {
        repositories.push([className, serviceInfo])
      } else if (serviceInfo.isRegistry) {
        registries.push([className, serviceInfo])
      } else if (serviceInfo.isService) {
        services.push([className, serviceInfo])
      }
    }

    this.generateTypeRegistrations(repositories)
    this.generateTypeRegistrations(services)
    this.generateTypeRegistrations(controllers)
    this.generateTypeRegistrations(registries)
  }

  private generateTypeRegistrations(items: Array<[string, ServiceTypeInfo]>) {
    for (const [className, serviceInfo] of items) {
      if (this.registeredTypes.has(className)) continue

      this.registeredTypes.add(className)

      if (serviceInfo.requiresEnv) {
        this.registrationOf.set(
          className,
          `container.register(${className}, { 
  useClass: ${className} 
})`
        )
        continue
      }

      if (serviceInfo.isRegistry) {
        this.registrationOf.set(
          className,
          `container.register(${className}, { 
  useFactory: (container) => new ${className}()
})`
        )
        continue
      }

      if (serviceInfo.dependencies.length > 0) {
        const depsString = serviceInfo.dependencies
          .map(dep => {
            if (dep.isLazy) {
              return `lazy(() => container.resolve(${dep.typeName}))`
            }
            return `container.resolve(${dep.typeName})`
          })
          .join(', ')

        this.registrationOf.set(
          className,
          `container.register(${className}, { 
  useFactory: (container) => new ${className}(${depsString})
})`
        )
      } else {
        this.registrationOf.set(
          className,
          `container.register(${className}, { 
  useFactory: () => new ${className}()
})`
        )
      }
    }
  }

  private addImport(filePath: string, className: string) {
    if (!filePath || !className) return

    if (['Array', 'Promise', 'Map', 'Set', 'any', 'string', 'number', 'boolean', 'Env'].includes(className)) {
      return
    }

    if (/^[A-Z]$/.test(className) || ['T', 'K', 'V', 'U', 'P', 'R'].includes(className)) {
      return
    }

    const importPath = this.getRelativeImportPath(filePath)
    if (!this.imports.has(importPath)) {
      this.imports.set(importPath, new Set())
    }
    this.imports.get(importPath)?.add(className)
  }

  private getRelativeImportPath(filePath: string): string {
    let relativePath = path
      .relative(GENERATED_DIR, filePath)
      .replace(/\\/g, '/')
      .replace(/\.tsx?$/, '')
      .replace(/\/index$/, '')

    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath
    }

    return relativePath
  }

  private generateTier(tier: Tier) {
    const { classes, tokens } = this.closure(tier)
    const output = path.join(GENERATED_DIR, tier, 'dependency.ts')
    const relative = (file: string) => {
      let result = path
        .relative(path.dirname(output), file)
        .replace(/\\/g, '/')
        .replace(/\.tsx?$/, '')
      if (!result.startsWith('.')) result = './' + result
      return result
    }
    const providers = Array.from(tokens)
      .filter(token => fs.existsSync(path.join(PROVIDERS_DIR, `${token}.ts`)))
      .sort()
    const unknown = Array.from(tokens).filter(token => !providers.includes(token) && !this.isSymbolToken(token))
    if (unknown.length) throw new Error(`${tier}: resolved names without a class or provider: ${unknown.sort().join(', ')}`)
    const unprovided = Array.from(tokens).filter(token => !providers.includes(token))
    if (unprovided.length) throw new Error(`${tier}: injection tokens without a provider in src/di/providers: ${unprovided.sort().join(', ')}`)

    const imports = new Map<string, Set<string>>()
    const add = (file: string, name: string) => {
      const key = relative(file)
      if (!imports.has(key)) imports.set(key, new Set())
      imports.get(key)!.add(name)
    }
    const ordered = Array.from(this.registrationOf.keys()).filter(name => classes.has(name))
    for (const name of ordered) {
      const info = this.serviceInfoMap.get(name)!
      add(info.sourceFilePath, name)
      for (const dep of info.dependencies) {
        const depInfo = this.serviceInfoMap.get(dep.typeName)
        if (depInfo) add(depInfo.sourceFilePath, dep.typeName)
        else {
          const symbolFile = this.symbolFileOf(dep.typeName)
          if (symbolFile) add(symbolFile, dep.typeName)
        }
      }
    }
    const header = [
      `import { container, Container } from '${relative(path.join(API_ROOT, 'src/decorators/di.ts'))}'`,
      `import { lazy } from '${relative(path.join(API_ROOT, 'src/decorators/lazy.ts'))}'`,
      `import { ContextManager } from '@/utils/context'`,
      `import { DatabaseRegistry } from '${relative(path.join(API_ROOT, 'src/di/data.ts'))}'`,
      ...providers.map(token => `import { provide as provide${token} } from '${relative(path.join(PROVIDERS_DIR, `${token}.ts`))}'`),
      ...Array.from(imports.entries()).map(([from, names]) => `import { ${Array.from(names).sort().join(', ')} } from '${from}'`)
    ].join('\n')

    const text = `// Generated by script/gen-di.ts for the ${tier} Worker. Do not edit.
${header}

${ordered.map(name => this.registrationOf.get(name)).join('\n\n')}

// Kept per module so two tiers loaded into one isolate never replace each other's providers.
const registry = new DatabaseRegistry([${providers.map(token => `provide${token}`).join(', ')}])

export function initializeInfrastructure(ctx: ContextManager, targetContainer: Container) {
  const selected = container.isRegistered(DatabaseRegistry) ? container.resolve(DatabaseRegistry) : registry
  selected.register(ctx, targetContainer)
}

export function initializeCore() {
  return {
    container
  }
}
`
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, text)
    console.log(`✅ Generated ${tier} DI configuration (${ordered.length} classes, ${providers.length} providers) at ${output}`)
  }

  private isSymbolToken(name: string): boolean {
    return this.symbolFileOf(name) !== undefined
  }

  private symbolFileOf(name: string): string | undefined {
    for (const [importPath, symbols] of this.symbolUsages.entries())
      if (symbols.has(name)) return path.resolve(path.dirname(path.join(GENERATED_DIR, 'dependency.ts')), importPath) + '.ts'
    return undefined
  }
}

new DIGenerator().generate()
