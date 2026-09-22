/**
 * GET /v1/user/labs and the lab: prefix on /v1/user/setting/enable|disable
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))
vi.mock('@/decorators/controller', () => ({ Controller: () => (target: any) => target }))
vi.mock('@/decorators/route', () => ({
  Get: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc,
  Post: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc
}))

import { UserController } from '@/handler/http/userController'
import { UserService } from '@/domain/user'
import { LabService } from '@/domain/lab'
import { createMockCtx, createMockRequest } from '@test/helpers/mockFactory'

function labService(rows: any[] = []) {
  const labRepo = { listByUser: vi.fn().mockResolvedValue(rows), isEnabled: vi.fn(), upsert: vi.fn().mockResolvedValue(undefined) }
  return { service: new (LabService as any)(labRepo) as LabService, labRepo }
}

function wire(rows: any[] = []) {
  const { service: lab, labRepo } = labService(rows)
  const userService = Object.create(UserService.prototype) as UserService
  Object.assign(userService, { labService: lab, userRepo: {} })
  const ctrl = new (UserController as any)()
  Object.assign(ctrl, { userService, labService: lab })
  return { ctrl: ctrl as UserController, labRepo }
}

describe('GET /v1/user/labs', () => {
  test('returns the registry with the user state', async () => {
    const at = new Date('2026-09-08T01:02:03.000Z')
    const { ctrl, labRepo } = wire([{ feature: 'youtube', enabled: true, created_at: at, updated_at: at }])
    const resp = await ctrl.handleUserLabsRequest(createMockCtx({ userId: 7 }), new Request('http://x/v1/user/labs'))
    expect(await resp.json()).toEqual({
      code: 200,
      message: 'ok',
      data: { features: [{ key: 'youtube', status: 'active', enabled: true, enabled_at: '2026-09-08T01:02:03.000Z' }] }
    })
    expect(labRepo.listByUser).toHaveBeenCalledWith(7)
  })

  test('no row means off', async () => {
    const { ctrl } = wire([])
    const resp = await ctrl.handleUserLabsRequest(createMockCtx(), new Request('http://x/v1/user/labs'))
    expect((await resp.json()).data.features).toEqual([{ key: 'youtube', status: 'active', enabled: false, enabled_at: null }])
  })
})

describe('lab: keys on /setting/enable and /setting/disable', () => {
  test('enable writes enabled=true', async () => {
    const { ctrl, labRepo } = wire()
    const resp = await ctrl.handleEnableUserSettingRequest(createMockCtx({ userId: 7 }), createMockRequest({ key: 'lab:youtube' }))
    expect((await resp.json()).data).toBe('ok')
    expect(labRepo.upsert).toHaveBeenCalledWith(7, 'youtube', true)
  })

  test('disable writes enabled=false', async () => {
    const { ctrl, labRepo } = wire()
    await ctrl.handleDisableUserSettingRequest(createMockCtx({ userId: 7 }), createMockRequest({ key: 'lab:youtube' }))
    expect(labRepo.upsert).toHaveBeenCalledWith(7, 'youtube', false)
  })

  test('unknown feature is rejected and nothing is written', async () => {
    const { ctrl, labRepo } = wire()
    await expect(ctrl.handleEnableUserSettingRequest(createMockCtx(), createMockRequest({ key: 'lab:podcast' }))).rejects.toMatchObject({ name: 'ERROR_PARAM' })
    expect(labRepo.upsert).not.toHaveBeenCalled()
  })
})
