import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pool} from 'pg'
import {DesktopAuthRepo} from '@/infra/repository/dbDesktopAuth'
import {desktopDigest, issueDesktopCode, redeemDesktopCode} from '@/domain/desktopAuthPolicy'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'

const database = process.env.SLAX_DESKTOP_AUTH_TEST_DATABASE_URL
// This suite targets an explicitly supplied disposable PostgreSQL database, never application configuration.
describe.skipIf(!database)('desktop code atomicity on PostgreSQL',()=>{
 const schema='desktop_auth_'+randomUUID().replaceAll('-','')
 let pool: Pool
 let repo: DesktopAuthRepo
 const state='A'.repeat(43),verifier='a'.repeat(43)
 beforeAll(async()=>{
  pool=new Pool({connectionString:database,max:4,options:`-c search_path=${schema}`})
  await pool.query(`CREATE SCHEMA ${schema}`)
  await pool.query(`CREATE TABLE sr_user(id integer PRIMARY KEY,uuid text,name text,email text,picture text,lang text,deleted_at timestamp); INSERT INTO sr_user VALUES(1,'account-1','User','fixture@example.test','','en',NULL)`)
  await pool.query(await readFile(new URL('../../prisma/pg_migrations/20261016053229_desktop_login_handoff/migration.sql',import.meta.url),'utf8'))
  const sql={ $queryRawUnsafe:async(text:string,...values:unknown[])=>(await pool.query(text,values)).rows,$executeRawUnsafe:async(text:string,...values:unknown[])=>(await pool.query(text,values)).rowCount }
  repo=new DesktopAuthRepo((()=>sql) as never)
 })
 afterAll(async()=>{if(pool){await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end()}})
 async function issue(){return issueDesktopCode(repo,{code_challenge:await desktopDigest(verifier),state},1,'fixture')}
 const sign=async()=>({token:'fixture-desktop-session',expires_at:new Date(Date.now()+3600000).toISOString()})
 it('has one winner across concurrent database connections and rejects replay',async()=>{
  const issued=await issue();const input={code:issued.code,state,code_verifier:verifier}
  const results=await Promise.allSettled([redeemDesktopCode(repo,input,'fixture',sign),redeemDesktopCode(repo,input,'fixture',sign)])
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(result=>result.status==='rejected')).toHaveLength(1)
  await expect(redeemDesktopCode(repo,input,'fixture',sign)).rejects.toMatchObject({status:400})
  const row=(await pool.query('SELECT * FROM sr_desktop_auth_code WHERE code_hash=$1',[await desktopDigest(issued.code)])).rows[0]
  expect(row).toBeUndefined()
 })
 it('deletes each same-environment attempt, preserves other environments and denies expiry',async()=>{
  for(const wrong of [{code_verifier:'b'.repeat(43)},{state:'E'.repeat(42)+'A'}]) {
   const issued=await issue(); const input={code:issued.code,state,code_verifier:verifier}
   await expect(redeemDesktopCode(repo,{...input,...wrong},'fixture',sign)).rejects.toMatchObject({status:400})
   expect((await pool.query('SELECT 1 FROM sr_desktop_auth_code WHERE code_hash=$1',[await desktopDigest(issued.code)])).rowCount).toBe(0)
  }
  const issued=await issue();const input={code:issued.code,state,code_verifier:verifier}
  await expect(redeemDesktopCode(repo,input,'other',sign)).rejects.toMatchObject({status:400})
  expect((await pool.query('SELECT 1 FROM sr_desktop_auth_code WHERE code_hash=$1',[await desktopDigest(issued.code)])).rowCount).toBe(1)
  await pool.query("UPDATE sr_desktop_auth_code SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE code_hash=$1",[await desktopDigest(issued.code)])
  await expect(redeemDesktopCode(repo,input,'fixture',sign)).rejects.toMatchObject({status:400})
 })
 it('denies deleted users both at issuance and redemption',async()=>{
  const issued=await issue();await pool.query('UPDATE sr_user SET deleted_at=CURRENT_TIMESTAMP WHERE id=1')
  await expect(issue()).rejects.toMatchObject({status:400})
  await expect(redeemDesktopCode(repo,{code:issued.code,state,code_verifier:verifier},'fixture',sign)).rejects.toMatchObject({status:400})
  await pool.query('UPDATE sr_user SET deleted_at=NULL WHERE id=1')
 })
 it('consumes on signer failure and cleans old expired rows in a bounded batch',async()=>{
  const issued=await issue();const input={code:issued.code,state,code_verifier:verifier}
  await expect(redeemDesktopCode(repo,input,'fixture',async()=>{throw Error('signer unavailable')})).rejects.toThrow('signer unavailable')
  await expect(redeemDesktopCode(repo,input,'fixture',sign)).rejects.toMatchObject({status:400})
  await pool.query("UPDATE sr_desktop_auth_code SET expires_at=CURRENT_TIMESTAMP-interval '2 days'")
  await repo.cleanup();expect((await pool.query('SELECT count(*)::integer AS count FROM sr_desktop_auth_code')).rows[0].count).toBe(0)
 })
})
