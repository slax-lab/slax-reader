import { CONFIG } from './config'
let ensuring: Promise<void> | undefined
export const ensureLocaleCalibrationAlarm = (): Promise<void> => {
  if (!ensuring)
    ensuring = (async () => {
      if (!(await browser.alarms.get(CONFIG.BOOKMARK_RECORDS_SYNC_KEY)))
        await browser.alarms.create(CONFIG.BOOKMARK_RECORDS_SYNC_KEY, { periodInMinutes: CONFIG.SYNC_INTERVAL_MINUTES })
    })().finally(() => {
      ensuring = undefined
    })
  return ensuring
}
