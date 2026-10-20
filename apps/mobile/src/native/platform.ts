import {requireNativeModule} from 'expo';

interface SlaxPlatform {
  googleSignIn(webClientId: string): Promise<string|null>;
  openInAppBrowser(url: string): Promise<void>;
  revokeReaderResources(): Promise<void>;
  activateReaderResources(owner: string): Promise<void>;
  setWebSessionCookie(origin: string, token: string|null, domain: string): Promise<void>;
  resolveDns(host: string, server: string|null): Promise<string>;
  systemInfo(): Record<string,string>;
  shareImage(uri: string, title: string, url: string|null): Promise<void>;
  shareArticle(uri: string|null, title: string, text: string, url: string): Promise<void>;
}
const platform = () => requireNativeModule<SlaxPlatform>('SlaxPlatform');
export const googleSignIn = (webClientId: string) => platform().googleSignIn(webClientId);
/** On iOS, invoke after a closing Modal's onDismiss, not after its visible state update. */
export async function openInAppBrowser(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || /[\u0000-\u0020\u007f\\]/.test(url)) {
    throw new Error('Invalid browser URL');
  }
  await platform().openInAppBrowser(parsed.href);
}
export const revokeReaderResources = () => platform().revokeReaderResources();
export const activateReaderResources = (owner: string) => platform().activateReaderResources(owner);
export const setWebSessionCookie = (origin: string, token: string|null, domain: string) => platform().setWebSessionCookie(origin, token, domain);
export const resolveDns = (host: string, server: string|null = null) => platform().resolveDns(host, server);
export const systemInfo = () => platform().systemInfo();
export const shareImage = (uri: string, title: string, url: string|null = null) => platform().shareImage(uri, title, url);
export const shareArticle = (uri: string|null, title: string, text: string, url: string) => platform().shareArticle(uri, title, text, url);
