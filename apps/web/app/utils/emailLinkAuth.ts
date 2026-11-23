import { EMAIL_LOGIN_PATH, EMAIL_LOGIN_WEB_PATH, parseEmailLinkProof } from '@slax-reader/contracts/email-auth'

declare global {
  interface Window { __slaxEmailLoginFragment?: string }
}

// Capture before application and third-party scripts can observe the incoming proof.
export const emailLoginStartupScript = `(() => {
  if (![${JSON.stringify(EMAIL_LOGIN_PATH)}, ${JSON.stringify(EMAIL_LOGIN_WEB_PATH)}].includes(location.pathname)) return;
  window.__slaxEmailLoginFragment = location.hash;
  history.replaceState(history.state, '', location.pathname);
})();`

export function takeEmailLoginProof() {
  const fragment = window.__slaxEmailLoginFragment
  delete window.__slaxEmailLoginFragment
  return fragment ? parseEmailLinkProof(new URLSearchParams(fragment.replace(/^#/, ''))) : null
}
