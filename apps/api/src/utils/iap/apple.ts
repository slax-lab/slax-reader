import * as jose from 'jose'
import * as x509 from '@peculiar/x509'
import { APPLE_ROOT_CA_G3_BASE64 } from '@/di/generated/apple-certs'

export class AppleJWSVerifier {
  private appleRootCert: x509.X509Certificate

  constructor() {
    const derBytes = this.base64ToArrayBuffer(APPLE_ROOT_CA_G3_BASE64)
    this.appleRootCert = new x509.X509Certificate(derBytes)
  }

  async verifyAndDecode<T = any>(signedPayload: string): Promise<T> {
    const [headerB64] = signedPayload.split('.')
    const header = JSON.parse(this.base64UrlDecode(headerB64))

    if (!header.x5c || header.x5c.length < 2) {
      throw new Error('Missing or invalid x5c certificate chain')
    }

    const certs = header.x5c.map((certB64: string) => new x509.X509Certificate(this.base64ToArrayBuffer(certB64)))

    await this.verifyCertificateChain(certs)

    const leafCert = certs[0]
    const publicKey = await leafCert.publicKey.export()

    // 使用 jose 验证签名
    const { payload } = await jose.compactVerify(signedPayload, publicKey)

    return JSON.parse(new TextDecoder().decode(payload)) as T
  }

  private async verifyCertificateChain(certs: x509.X509Certificate[]): Promise<void> {
    const rootCert = certs[certs.length - 1]

    // 验证根证书与本地 Apple Root CA G3
    const rootCertBytes = new Uint8Array(rootCert.rawData)
    const trustedRootBytes = new Uint8Array(this.appleRootCert.rawData)

    if (!this.arrayBuffersEqual(rootCertBytes, trustedRootBytes)) {
      throw new Error('Root certificate does not match trusted Apple Root CA G3')
    }

    // 验证根证书有效期
    const now = new Date()
    if (now < rootCert.notBefore || now > rootCert.notAfter) {
      throw new Error('Root certificate is expired or not yet valid')
    }

    // 验证证书链：每个证书由其上一级证书签发
    for (let i = 0; i < certs.length - 1; i++) {
      const cert = certs[i]
      const issuerCert = certs[i + 1]

      // 验证签名
      const isValid = await cert.verify({
        publicKey: await issuerCert.publicKey.export()
      })

      if (!isValid) {
        throw new Error(`Certificate chain validation failed at index ${i}`)
      }

      // 验证有效期
      if (now < cert.notBefore || now > cert.notAfter) {
        throw new Error(`Certificate at index ${i} is expired or not yet valid`)
      }
    }
  }

  private arrayBuffersEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const cleanBase64 = base64.replace(/[\s\n\r]/g, '')
    const binaryString = atob(cleanBase64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  }

  private base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) {
      base64 += '='
    }
    return atob(base64)
  }
}
