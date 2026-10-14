import { createJiti } from 'jiti'

// Reuse dev's selection without generating configuration or a transpilation cache.
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  moduleCache: false
})
try {
  const { readWebBindingSelection } = await jiti.import('./backend-binding.ts')
  const selection = readWebBindingSelection({ local: true })
  process.stdout.write(selection.configFound ? 'configured' : 'template')
} catch {
  // The caller owns diagnostics: TOML/parser exceptions can include operator values.
  process.exitCode = 1
}
