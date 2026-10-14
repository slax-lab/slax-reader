import { isLocaleInvalidation, isLocaleSender } from '../src/utils/localeRelay'

import { expect, it } from 'vitest'
it('requires exact trusted origin, top frame, extension id and protocol', () => {
  expect(isLocaleInvalidation({ type: 'slax-reader:account-locale-invalidated', version: 1 })).toBe(true)
  expect(isLocaleInvalidation({ type: 'slax-reader:account-locale-invalidated', version: 2 })).toBe(false)
  for (const sender of [
    { id: 'ext', url: 'https://reader.test.evil', frameId: 0 },
    { id: 'other', url: 'https://reader.test/', frameId: 0 },
    { id: 'ext', url: 'https://reader.test/', frameId: 1 }
  ])
    expect(isLocaleSender(sender, 'ext', 'https://reader.test')).toBe(false)
  expect(isLocaleSender({ id: 'ext', url: 'https://reader.test/user', frameId: 0 }, 'ext', 'https://reader.test')).toBe(true)
})
