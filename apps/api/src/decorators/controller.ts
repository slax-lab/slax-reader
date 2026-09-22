import { injectable } from './di'

export function Controller(_basePath: string = ''): ClassDecorator {
  return function (target: any) {
    return injectable()(target)
  }
}
