// Only a flag is persisted here. The database owner remains in its existing stamp.
export const interruptedUploadKey = 'slax:powersync:interruptedUpload'

export function hasInterruptedUpload() {
  try {
    return localStorage.getItem(interruptedUploadKey) === 'suspended'
  } catch {
    return false
  }
}
