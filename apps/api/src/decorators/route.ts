export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'all'

export function createRouteDecorator(method: HttpMethod) {
  return (_path: string): MethodDecorator => {
    return (_target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
      return descriptor
    }
  }
}

export const Get = createRouteDecorator('get')
export const Post = createRouteDecorator('post')
export const Put = createRouteDecorator('put')
export const Delete = createRouteDecorator('delete')
export const All = createRouteDecorator('all')
