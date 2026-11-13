export const EMAIL_CODE_CONFIG = {
  length: 6,
  ttlSeconds: 300,
  resendCooldownSeconds: 60,
  maxAttempts: 5,
  addressSendLimit: 5,
  ipSendLimit: 300,
  deviceSendLimit: 10,
  environmentSendLimit: 500,
  sendWindowSeconds: 60 * 60,
  dailySendWindowSeconds: 24 * 60 * 60,
  defaultFrom: 'Slax Reader <noreply@reader.slax.com>'
} as const
