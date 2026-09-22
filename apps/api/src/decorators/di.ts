export type FactoryFunction<T> = (container: Container) => T
export type Provider<T> = { useClass: new (...args: any[]) => T } | { useFactory: FactoryFunction<T>; uncached?: boolean } | { useValue: T }

export class Container {
  private instances = new Map<any, any>()
  private providers = new Map<any, Provider<any>>()
  private parent?: Container

  register<T>(token: any, provider: Provider<T>): void {
    this.providers.set(token, provider)
  }

  registerInstance<T>(token: any, instance: T): void {
    this.instances.set(token, instance)
  }

  resolve<T>(token: { new (...args: any[]): T } | symbol): T {
    const provider = this.providers.get(token)
    if (provider && 'useFactory' in provider && provider.uncached) {
      return this.createInstance<T>(provider)
    }

    if (this.instances.has(token)) {
      return this.instances.get(token) as T
    }

    if (provider) {
      const instance = this.createInstance<T>(provider)
      this.instances.set(token, instance)
      return instance
    }

    if (this.parent) {
      return this.parent.resolve<T>(token)
    }

    throw new Error(`No provider for ${String(token)}`)
  }

  private createInstance<T>(provider: Provider<T>): T {
    if ('useClass' in provider) {
      const ClassType = provider.useClass
      return new ClassType()
    } else if ('useFactory' in provider) {
      return provider.useFactory(this)
    } else if ('useValue' in provider) {
      return provider.useValue
    }
    throw new Error('Invalid provider configuration')
  }

  createChildContainer(): Container {
    const child = new Container()
    child.parent = this
    return child
  }

  isRegistered(token: any): boolean {
    return this.instances.has(token) || this.providers.has(token) || (this.parent ? this.parent.isRegistered(token) : false)
  }

  clone(): Container {
    const newContainer = new Container()
    this.providers.forEach((provider, token) => {
      newContainer.providers.set(token, provider)
    })
    return newContainer
  }
}

export const container = new Container()

export function injectable() {
  return function <T extends new (...args: any[]) => any>(target: T): T {
    return target
  }
}

export function singleton() {
  return injectable()
}

export function inject(token: any) {
  return function (_target: any, _propertyKey: string | symbol | undefined, _parameterIndex: number) {}
}
