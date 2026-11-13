const LAST_LOGIN_EMAIL_KEY = 'slax:last-login-email'

export const readLastLoginEmail = (): string => {
  let email: string | null
  try {
    email = localStorage.getItem(LAST_LOGIN_EMAIL_KEY)
  } catch {
    return ''
  }
  if (!email || email.length > 254) return ''
  const input = document.createElement('input')
  input.type = 'email'
  input.value = email
  return input.validity.valid ? email : ''
}

export const rememberLoginEmail = (email: string): void => {
  try {
    localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email)
  } catch {
    // A blocked convenience preference must not interrupt an authenticated login.
  }
}
