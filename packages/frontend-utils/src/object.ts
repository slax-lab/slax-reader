/* eslint-disable @typescript-eslint/no-explicit-any */

import { isObject } from './is'

/**
 * @description: 检查目标对象中是否有源对象的键值并合并过去
 */
export function deepMerge<T = any>(src: any = {}, target: any = {}): T {
  let key: string
  for (key in target) {
    src[key] = isObject(src[key]) ? deepMerge(src[key], target[key]) : (src[key] = target[key])
  }
  return src
}

/**
 * @description: 深度比较两个对象是否相等
 */
export function objectDeepEqual(obj1: any, obj2: any) {
  if (obj1 === obj2) {
    return true
  }

  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false
  }

  const keys1 = Object.keys(obj1)
  const keys2 = Object.keys(obj2)

  if (keys1.length !== keys2.length) {
    return false
  }

  for (const key of keys1) {
    if (!keys2.includes(key) || !objectDeepEqual(obj1[key], obj2[key])) {
      return false
    }
  }

  return true
}
