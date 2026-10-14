/**
 * 带超时的 Promise 包装器。
 * 在 promise 完成前若超过 ms 毫秒则 reject。
 *
 * 替代常见的 `Promise.race([new Promise(async resolve => ...), timeout])` 反模式，
 * 避免 async executor 吞掉异常。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * 根据 HTML content key 推导截图的 R2 key。
 * 例：`html/parse/workflow_123_456.html` → `screenshot/workflow_123_456.jpg`
 */
export function deriveScreenshotKey(contentKey: string): string {
  return contentKey.replace('html/parse/', 'screenshot/').replace('.html', '.jpg')
}
