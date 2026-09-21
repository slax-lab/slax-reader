// dev vendor shim，见 vendor.config.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V = (globalThis as any).__SLAX_VENDOR__.markmapCommon

export const wrapFunction = V.wrapFunction
