import { describe, expect, it } from 'vitest'
import { parseEmailLinkProof } from '@slax-reader/contracts/email-auth'
import { emailLoginStartupScript, takeEmailLoginProof } from '~/utils/emailLinkAuth'

const proof = { email: 'person+test@example.com', request_id: '550e8400-e29b-41d4-a716-446655440000', token: 'a'.repeat(43) }
const hash = '#' + new URLSearchParams(proof)

describe('email link URL boundary', () => {
  it('parses the mailbox and opaque proof without changing plus addressing', () => {
    expect(parseEmailLinkProof(new URLSearchParams(hash.slice(1)))).toEqual(proof)
    for (const fragment of ['', '#token=x', hash.replace(proof.token, 'short'), hash.replace('person%2Btest%40example.com', 'invalid')]) expect(parseEmailLinkProof(new URLSearchParams(fragment.replace(/^#/, '')))).toBeNull()
  })
  it.each(['/email-login', '/email-login-web'])('captures and clears %s before later scripts, then releases proof once', path => {
    history.replaceState(null, '', path + hash)
    new Function(emailLoginStartupScript)()
    expect(location.hash).toBe('')
    expect(takeEmailLoginProof()).toEqual(proof)
    expect(takeEmailLoginProof()).toBeNull()
  })
  it('does not capture unrelated reader fragment navigation', () => {
    history.replaceState(null, '', '/bookmarks#section')
    new Function(emailLoginStartupScript)()
    expect(location.hash).toBe('#section')
    expect(takeEmailLoginProof()).toBeNull()
  })
})
