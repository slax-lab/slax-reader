import { API_ROOT, ROOT } from './root'
import { execFileSync } from 'child_process'
import * as appleFs from 'fs'
import * as applePath from 'path'

const CERTS = [
  {
    name: 'APPLE_ROOT_CA_G3',
    url: 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer'
  }
]

async function main() {
  const output: string[] = ['// Auto-generated - DO NOT EDIT', '// Generated at: ' + new Date().toISOString(), '']

  const tempDir = appleFs.mkdtempSync(applePath.join(ROOT, '.apple-certs-'))
  try {
    for (const cert of CERTS) {
      const tempFile = applePath.join(tempDir, `${cert.name}.cer`)
      execFileSync('curl', ['-s', '-o', tempFile, cert.url], { cwd: ROOT })

      const derBytes = appleFs.readFileSync(tempFile)
      const base64 = derBytes.toString('base64')

      const crypto = await import('crypto')
      const fingerprint = crypto.createHash('sha256').update(derBytes).digest('hex').toUpperCase()

      output.push(`export const ${cert.name}_BASE64 = \`${base64}\`;`)
      output.push(`export const ${cert.name}_FINGERPRINT = "${fingerprint}";`)
      output.push('')
    }
  } finally {
    appleFs.rmSync(tempDir, { recursive: true, force: true })
  }

  const outputPath = applePath.join(API_ROOT, 'src/di/generated/apple-certs.ts')
  appleFs.mkdirSync(applePath.dirname(outputPath), { recursive: true })
  appleFs.writeFileSync(outputPath, output.join('\n'))

  console.log(`Generated: ${outputPath}`)
}

main().catch(err => {
  console.error('Error generating Apple certs:', err)
  process.exit(1)
})
