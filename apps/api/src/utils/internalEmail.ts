// The internal/beta and dashboard allowlist is deployment configuration, not source. Personal
// addresses must never be committed, so they are read from WHITE_EMAILS (comma-separated).
// An unset or empty value denies every gated request.
const parseWhiteEmails = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)

export const isWhiteEmail = (env: Env, email: string): boolean => parseWhiteEmails(env.WHITE_EMAILS).includes(email)
