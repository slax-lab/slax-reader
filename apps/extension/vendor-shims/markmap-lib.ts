// dev vendor shim
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V = (globalThis as any).__SLAX_VENDOR__.markmapLib

export const builtInPlugins = V.builtInPlugins
export const Transformer = V.Transformer
