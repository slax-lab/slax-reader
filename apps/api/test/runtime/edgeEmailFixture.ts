import edge from '../../src/entry/edge/index'
export * from '../../src/entry/edge/index'

// Wrangler's local email trigger reaches only the primary Worker. Production Email Routing delivers
// straight to Core; this smoke-only Edge forwards the untouched message to the local Core handler.
export default {
  ...edge,
  async email(message: ForwardableEmailMessage, env: Env) {
    await (env.CORE as unknown as { email(message: ForwardableEmailMessage): Promise<void> }).email(message)
  }
}
