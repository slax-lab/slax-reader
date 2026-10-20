import {describe, expect, it, vi} from 'vitest'
import {parseDesktopAuthIntent, parseDesktopCodeRequest, parseDesktopExchangeRequest, desktopCallback} from '@slax-reader/contracts/desktop-auth'
import {desktopDigest, issueDesktopCode, redeemDesktopCode, type DesktopCodeStore} from '@/domain/desktopAuthPolicy'
import {Auth} from '@/utils/jwt'
import {auth, authToken, isWhitelisted} from '@/middleware/auth'
import {ContextManager} from '@/utils/context'
import {Hashid} from '@/utils/hashids'
import {encodeEdgeIdentity, EDGE_SECRET_HEADER, EDGE_IDENTITY_HEADER} from '@/const/edge'
import {desktopAuthBody, limitDesktopAuth} from '@/middleware/desktopAuth'

const verifier = 'a'.repeat(43), state = 'A'.repeat(43), code = 'B'.repeat(42) + 'A'
const config = {DESKTOP_AUTH_ENABLED: 'true', DESKTOP_AUTH_DEPLOYMENT_ID: 'test', FRONT_END_URL: 'https://reader.test',
 DESKTOP_AUTH_RATE_LIMITER: {limit: vi.fn(async () => ({success: true}))}, JWT_SECRET_TEXT: 'desktop-test-signing-fixture-not-production', JWT_ISSUER: 'fixture', JWT_ALGORITHMS: 'HS256', JWT_EXPIRES: '3600', HASH_IDS_SALT: 'fixture', EDGE_SHARED_SECRET: 'fixture'} as unknown as Env
const ctx = () => new ContextManager({waitUntil: vi.fn()} as never, config)

describe('desktop handoff policy', () => {
 it('validates canonical public inputs and permits only fixed callbacks', () => {
  expect(parseDesktopAuthIntent({client: 'mac', code_challenge: state, state})).toBeTruthy()
  expect(parseDesktopAuthIntent({client: ['mac', 'mac'], code_challenge: state, state})).toBeNull()
  expect(parseDesktopCodeRequest({code_challenge: state, state, redirect_uri: 'attacker:'})).toBeNull()
  expect(parseDesktopCodeRequest({code_challenge: 'B'.repeat(43), state})).toBeNull()
  expect(parseDesktopExchangeRequest({code, state, code_verifier: 'short'})).toBeNull()
  expect(desktopCallback(code, state)).toBe(`slaxreader-mac://auth?code=${code}&state=${state}`)
  expect(() => desktopCallback('x&token=secret',state)).toThrow()
 })
 it('matches the RFC 7636 S256 test vector', async () => {
  expect(await desktopDigest('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
 })
 it('stores only digests, returns an opaque expiring code and consumes before signing', async () => {
  let binding: unknown
  const store: DesktopCodeStore = {issue: vi.fn(async value => {binding=value; return new Date('2026-10-16T00:02:00Z')}), consume: vi.fn(async () => ({id:1,uuid:'uuid',name:'User',email:'fixture@example.test',picture:'',lang:'en'})),cleanup:vi.fn()}
  const issued = await issueDesktopCode(store,{code_challenge:state,state},1,'test')
  expect(issued.code).toHaveLength(43)
  expect(binding).toEqual({codeHash:await desktopDigest(issued.code),stateHash:await desktopDigest(state),challenge:state,deployment:'test'})
  const sign=vi.fn(async () => {expect(store.consume).toHaveBeenCalledOnce();throw Error('fixture signer failed')})
  await expect(redeemDesktopCode(store,{code:issued.code,state,code_verifier:verifier},'test',sign)).rejects.toThrow('fixture signer failed')
  expect(sign).toHaveBeenCalledOnce()
 })
 it('does not sign a rejected code and does not expose internal account IDs', async () => {
  const store: DesktopCodeStore={issue:vi.fn(),consume:vi.fn(async()=>null),cleanup:vi.fn()};const sign=vi.fn()
  await expect(redeemDesktopCode(store,{code,state,code_verifier:verifier},'test',sign)).rejects.toMatchObject({status:400,code:'DESKTOP_AUTH_INVALID'})
  expect(sign).not.toHaveBeenCalled()
 })
 it('bounds streaming request bodies and rejects duplicate or malformed fields', async () => {
  const request=(body:string)=>new Request('https://api.test/v1/auth/desktop/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body})
  await expect(desktopAuthBody(request('{"state":"a","state":"b"}'))).rejects.toMatchObject({status:400})
  await expect(desktopAuthBody(request('x'.repeat(2049)))).rejects.toMatchObject({status:413})
  await expect(desktopAuthBody(request('{'))).rejects.toMatchObject({status:400})
 })
 it('fails closed on missing deployment/limiter and denies throttled exchange without parsing a code',async()=>{
  const request=new Request('https://api.test/v1/auth/desktop/exchange',{method:'POST'})
  const context=ctx(); await expect(limitDesktopAuth(request,context)).resolves.toBeUndefined()
  const limited=new ContextManager({} as never,{...config,DESKTOP_AUTH_RATE_LIMITER:{limit:async()=>({success:false})}} as never)
  await expect(limitDesktopAuth(request,limited)).rejects.toMatchObject({status:429})
  await expect(limitDesktopAuth(request,new ContextManager({} as never,{...config,DESKTOP_AUTH_RATE_LIMITER:undefined}))).rejects.toMatchObject({status:503})
  await expect(limitDesktopAuth(request,new ContextManager({} as never,{...config,DESKTOP_AUTH_ENABLED:'false'}))).rejects.toMatchObject({status:503})
 })
 it('exempts only the exact exchange path from bearer auth',()=>{
  expect(isWhitelisted('/v1/auth/desktop/exchange')).toBe(true)
  expect(isWhitelisted('/v1/auth/desktop/exchange/other')).toBe(false)
  expect(isWhitelisted('/v1/auth/desktop/code')).toBe(false)
 })
 it('preserves verified client marker through direct and trusted edge authentication',async()=>{
  const id=String(new Hashid(config).encodeId(1));const token=await new Auth(config).sign({id,email:'fixture@example.test',lang:'en',client:'macos'})
  const context=ctx();await authToken(context,token);expect(context.get('sessionClient')).toBe('macos')
  const edge=ctx();const request=new Request('https://api.test/v1/user/me',{headers:{[EDGE_SECRET_HEADER]:'fixture',[EDGE_IDENTITY_HEADER]:encodeEdgeIdentity({deId:1,enId:Number(id),email:'fixture@example.test',lang:'en',audience:'reader',client:'macos'})}})
  const container={resolve:()=>({$queryRaw:async()=>[{id:1}]})}
  await auth(request,edge,container as never);expect(edge.get('sessionClient')).toBe('macos')
  const legacy=await new Auth(config).sign({id,email:'fixture@example.test',lang:'en'});expect((await new Auth(config).verify(legacy)).client).toBeUndefined()
 })
})
