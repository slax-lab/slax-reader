/**
 * App UserAgent utilities for iOS and Android validation
 */

export enum AppPlatform {
  iOS = 'ios',
  Android = 'android',
  Unknown = 'unknown'
}

/**
 * iOS UserAgent pattern:
 * SlaxReader/1.0.1 Build/689 CFNetwork/1404.0.5 Darwin/22.3.0
 */
const IOS_UA_PATTERN = /^SlaxReader\/[\d.]+\s+Build\/\d+\s+CFNetwork\/[\d.]+\s+Darwin\/[\d.]+/

/**
 * Android UserAgent pattern:
 * com.slax.reader/1.0.1 (Android 15; en_US; Pixel 7a; Build/689; Webkit/xxxxx)
 */
const ANDROID_UA_PATTERN = /^com\.slax\.reader\/[\d.]+\s+\(Android\s+[\d.]+;/

/**
 * Validate if the UserAgent is from SlaxReader iOS native app
 */
export function isSlaxReaderNativeIOS(userAgent: string): boolean {
  return IOS_UA_PATTERN.test(userAgent)
}

/**
 * Validate if the UserAgent is from SlaxReader Android native app
 */
export function isSlaxReaderNativeAndroid(userAgent: string): boolean {
  return ANDROID_UA_PATTERN.test(userAgent)
}

/**
 * Validate if the UserAgent is from any SlaxReader native app (iOS or Android).
 * 与 utils/environment.ts 的 isSlaxReaderApp() 不同：本函数按 UA 字符串精确匹配原生 App 的
 * UserAgent 格式（供 server 端等拿不到浏览器 navigator 的场景用），后者判断浏览器内是否运行在
 * SlaxReader App 的内嵌 WebView 里（读 navigator.userAgent）。两者用途不同，命名区分避免自动导入歧义。
 */
export function isSlaxReaderNativeApp(userAgent: string): boolean {
  return isSlaxReaderNativeIOS(userAgent) || isSlaxReaderNativeAndroid(userAgent)
}

/**
 * Get the platform type from UserAgent
 */
export function getAppPlatform(userAgent: string): AppPlatform {
  if (isSlaxReaderNativeIOS(userAgent)) {
    return AppPlatform.iOS
  }
  if (isSlaxReaderNativeAndroid(userAgent)) {
    return AppPlatform.Android
  }
  return AppPlatform.Unknown
}

/**
 * Get the current UserAgent from browser
 */
export function getUserAgent(): string {
  if (typeof window === 'undefined' || !window.navigator) {
    return ''
  }
  return window.navigator.userAgent
}
