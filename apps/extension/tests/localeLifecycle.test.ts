import { ensureLocaleCalibrationAlarm } from '../src/entrypoints/background/localeAlarm'
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => vi.unstubAllGlobals())
it('recreates missing alarm once without postponing an existing alarm', async () => {
  const get = vi.fn().mockResolvedValue(undefined),
    create = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('browser', { alarms: { get, create } })
  await Promise.all([ensureLocaleCalibrationAlarm(), ensureLocaleCalibrationAlarm()])
  expect(create).toHaveBeenCalledTimes(1)
  get.mockResolvedValue({ scheduledTime: 123 })
  await ensureLocaleCalibrationAlarm()
  expect(create).toHaveBeenCalledTimes(1)
})
