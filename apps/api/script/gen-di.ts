import { API_ROOT, API_TSCONFIG } from './root'
import fs from 'fs'
import path from 'path'

import { Project, SyntaxKind } from 'ts-morph'

const GENERATED_PATH = path.resolve(API_ROOT, 'src/di/generated/dependency.ts')

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
    this.generateOutput()
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
      this.addImport(serviceInfo.sourceFilePath, className)

      if (serviceInfo.requiresEnv) {
        this.registrations.add(`container.register(${className}, { 
  useClass: ${className} 
})`)
        continue
      }

      if (serviceInfo.isRegistry) {
        this.registrations.add(`container.register(${className}, { 
  useFactory: (container) => new ${className}()
})`)
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

        this.registrations.add(`container.register(${className}, { 
  useFactory: (container) => new ${className}(${depsString})
})`)
      } else {
        this.registrations.add(`container.register(${className}, { 
  useFactory: () => new ${className}()
})`)
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
      .relative(path.dirname(GENERATED_PATH), filePath)
      .replace(/\\/g, '/')
      .replace(/\.tsx?$/, '')
      .replace(/\/index$/, '')

    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath
    }

    return relativePath
  }

  private generateOutput() {
    const coreImports = [
      `import { container, Container } from '../../decorators/di'`,
      `import { lazy } from '../../decorators/lazy'`,
      `import { ContextManager } from '@/utils/context'`
    ]

    const symbolModuleImports = Array.from(this.symbolImports).map(path => {
      if (this.symbolUsages.has(path)) {
        const symbols = Array.from(this.symbolUsages.get(path) || []).join(', ')
        return `import { ${symbols} } from '${path}'`
      }
      return `import * as Symbols from '${path}'`
    })

    const moduleImports = Array.from(this.imports.entries())
      .filter(([path, classes]) => classes.size > 0)
      .map(([importPath, classes]) => {
        const classNames = Array.from(classes).join(', ')
        return `import { ${classNames} } from '${importPath}'`
      })

    const importStatements = [...coreImports, ...symbolModuleImports, ...moduleImports].join('\n')

    const registryInitializations = Array.from(this.serviceInfoMap.entries())
      .filter(([_, info]) => info.isRegistry)
      .map(([registry, _]) => `  container.resolve(${registry}).register(ctx, targetContainer);`)
      .join('\n')

    const output = `
${importStatements}

${Array.from(this.registrations).join('\n\n')}

export function initializeInfrastructure(ctx: ContextManager, targetContainer: Container) {
${registryInitializations}
}

export function initializeCore() {
  return {
    container
  };
}`

    fs.writeFileSync(GENERATED_PATH, output)
    console.log(`✅ Generated DI configuration at ${GENERATED_PATH}`)
  }
}

new DIGenerator().generate()
