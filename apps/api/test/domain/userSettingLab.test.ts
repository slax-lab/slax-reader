import { describe, expect, test, vi } from 'vitest'
import { UserService } from '@/domain/user'

function createService() {
  const labService = { setEnabled: vi.fn().mockResolvedValue(undefined) }
  const userRepo = { unbindPlatform: vi.fn(), getInfoByUserId: vi.fn() }
  const service = Object.create(UserService.prototype) as UserService
  Object.assign(service, { labService, userRepo })
  return { service, labService, userRepo }
}

const ctx = { getUserId: () => 7 } as never

describe('UserService.enableUserSetting with a lab: key', () => {
  test('enable forwards the feature key to LabService', async () => {
    const { service, labService, userRepo } = createService()
    expect(await service.enableUserSetting(ctx, 'lab:youtube', true)).toBe('ok')
    expect(labService.setEnabled).toHaveBeenCalledWith(7, 'youtube', true)
    expect(userRepo.unbindPlatform).not.toHaveBeenCalled()
  })

  test('disable forwards enable=false', async () => {
    const { service, labService } = createService()
    await service.enableUserSetting(ctx, 'lab:youtube', false)
    expect(labService.setEnabled).toHaveBeenCalledWith(7, 'youtube', false)
  })

  test('other keys never reach LabService', async () => {
    const { service, labService } = createService()
    await service.enableUserSetting(ctx, 'mail_collect', false)
    expect(labService.setEnabled).not.toHaveBeenCalled()
  })
})
