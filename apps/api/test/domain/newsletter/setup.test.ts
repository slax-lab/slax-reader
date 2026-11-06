import { describe, test, expect } from 'vitest'
import { db, repo, adapter } from './fixture'
import { NewsletterService } from '@/domain/newsletter'
import { UserController } from '@/handler/http/userController'
import { LabService } from '@/domain/lab'
import { LabRepo } from '@/infra/repository/dbLab'
import { UserRepo } from '@/infra/repository/dbUser'
import { UserService } from '@/domain/user'

function controller() {
  const user = Object.create(UserService.prototype)
  user.userRepo = new UserRepo(
    () => adapter(db),
    () => adapter(db)
  )
  user.labService = new LabService(new LabRepo(() => adapter(db)))
  return Object.assign(Object.create(UserController.prototype), {
    userService: user,
    newsletter: new NewsletterService(repo, {} as never)
  }) as UserController
}
const ctx = { getUserId: () => 1, env: { NEWSLETTER_DOMAIN: 'newsletterreader.slax.dev' } } as never
const enable = async (body: object) => {
  const response = await controller().handleEnableUserSettingRequest(ctx, new Request('http://local/v1/user/setting/enable', { method: 'POST', body: JSON.stringify(body) }))
  return response.json() as Promise<any>
}
const bindings = async () => (await db.query("SELECT platform_id FROM sr_platform_bind WHERE platform='newsletter'")).rows

describe('confirmed Newsletter setup on existing user settings', () => {
  test.each(['alex', 'jane.doe', 'Reader01', '读者Reader'])('ordinary Reader setting preserves its existing spelling and format: %j', async value => {
    const response = await controller().handleUserSettingRequest(
      ctx,
      new Request('http://local/v1/user/setting', { method: 'POST', body: JSON.stringify({ key: 'account', value }) })
    )
    expect(((await response.json()) as any).code).toBe(200)
    expect((await db.query('SELECT account FROM sr_user WHERE id=1')).rows).toEqual([{ account: value }])
  })
  test('plain Labs activation enables the feature without issuing an address', async () => {
    await db.exec('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
    expect((await enable({ key: 'lab:newsletter' })).code).toBe(200)
    expect((await db.query('SELECT enabled FROM sr_user_lab_feature WHERE user_id=1')).rows).toEqual([{ enabled: true }])
    expect(await bindings()).toEqual([])
    expect(await repo.address(1, 'newsletterreader.slax.dev', false)).toMatchObject({ status: 'not_provisioned', address: null })
  })
  test('explicit confirmation creates exactly the accepted address and repeats idempotently', async () => {
    const request = { key: 'lab:newsletter', newsletter_address: 'feed+jane01@newsletterreader.slax.dev' }
    expect((await enable(request)).code).toBe(200)
    expect((await enable(request)).code).toBe(200)
    expect(await bindings()).toEqual([{ platform_id: 'feed+jane01@newsletterreader.slax.dev' }])
  })
  test.each(['alex', 'abcde', 'Reader01', 'jane.doe', 'reader-1', ' reader01', 'reader01 ', '读者reader', 'abcdefghijklmnop'])(
    'rejects first-configuration token %j before changing Labs or writing an address',
    async token => {
      await db.exec('UPDATE sr_user_lab_feature SET enabled=false WHERE user_id=1')
      await db.query('UPDATE sr_user SET account=$1 WHERE id=1', [token])
      expect(await enable({ key: 'lab:newsletter', newsletter_address: 'feed+' + token + '@newsletterreader.slax.dev' })).toMatchObject({ data: { error: 'invalid_account' } })
      expect(await bindings()).toEqual([])
      expect((await db.query('SELECT enabled FROM sr_user_lab_feature WHERE user_id=1')).rows).toEqual([{ enabled: false }])
    }
  )
  test.each(['reader', 'reader01', 'abcdefghijklmno', '123456'])('accepts boundary token %j for first configuration', async token => {
    await db.query('UPDATE sr_user SET account=$1 WHERE id=1', [token])
    expect((await enable({ key: 'lab:newsletter', newsletter_address: 'feed+' + token + '@newsletterreader.slax.dev' })).code).toBe(200)
  })
  test.each([null, false, 123, '', {}])('malformed confirmation %j cannot create a mailbox', async newsletter_address => {
    expect(await enable({ key: 'lab:newsletter', newsletter_address })).toMatchObject({ data: { error: 'invalid_account' } })
    expect(await bindings()).toEqual([])
  })
  test('stale confirmation returns an actionable error without creating a binding', async () => {
    expect(await enable({ key: 'lab:newsletter', newsletter_address: 'feed+older01@newsletterreader.slax.dev' })).toMatchObject({ data: { error: 'address_changed' } })
    expect(await bindings()).toEqual([])
  })
})
