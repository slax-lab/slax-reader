import {beforeEach, describe, expect, it} from 'vitest'
import {startDesktopOAuth,takeDesktopOAuth,desktopIntentFromPath,desktopConsentPath} from '~~/app/utils/desktopAuth'
const intent={client:'mac' as const,code_challenge:'A'.repeat(43),state:'A'.repeat(43)}
describe('desktop provider state binding',()=>{
 beforeEach(()=>sessionStorage.clear())
 it.each(['google','apple'] as const)('retains a separate random provider nonce for %s',provider=>{
  const state=startDesktopOAuth(desktopConsentPath(intent),provider,'https://reader.test/auth',sessionStorage,1000)!
  expect(state.nonce).toMatch(/^[a-f0-9]{64}$/)
  expect(state.nonce).not.toBe(intent.state)
  const pending=takeDesktopOAuth(state,sessionStorage,1001)
  expect(pending.intent).toEqual(intent);expect(pending.provider).toBe(provider)
  expect(()=>takeDesktopOAuth(state,sessionStorage,1002)).toThrow()
 })
 it('rejects a wrong nonce without destroying the valid pending attempt',()=>{
  const state=startDesktopOAuth(desktopConsentPath(intent),'google','https://reader.test/auth',sessionStorage,1000)!
  expect(()=>takeDesktopOAuth({...state,nonce:'attacker'},sessionStorage,1001)).toThrow()
  expect(takeDesktopOAuth(state,sessionStorage,1001).intent).toEqual(intent)
 })
 it('rejects expired, changed-provider and malformed state',()=>{
  const state=startDesktopOAuth(desktopConsentPath(intent),'google','https://reader.test/auth',sessionStorage,1000)!
  expect(()=>takeDesktopOAuth({...state,platform:'apple'},sessionStorage,1001)).toThrow()
  const next=startDesktopOAuth(desktopConsentPath(intent),'google','https://reader.test/auth',sessionStorage,1000)!
  expect(()=>takeDesktopOAuth(next,sessionStorage,601000)).toThrow()
  expect(desktopIntentFromPath('/login?client=mac&client=mac')).toBeNull()
  expect(desktopIntentFromPath('https://attacker.test/login?client=mac')).toBeNull()
  expect(startDesktopOAuth('/bookmarks','google','https://reader.test/auth')).toBeNull()
 })
})
