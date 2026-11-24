import { describe, expect, test } from 'vitest'
import { errorDiagnostic, providerDiagnostic } from '@/utils/errorDiagnostic'

describe('errorDiagnostic', () => {
  test('reads bounded fields without serializing the error', () => {
    const error = Object.assign(new Error('x'.repeat(600)), { code: 'P2002', meta: { target: ['id'] }, data: { secret: true } })
    const result = errorDiagnostic(error)
    expect(result).toMatchObject({ name: 'Error', code: 'P2002', meta: { target: ['id'] } })
    expect(result.message).toHaveLength(500)
    expect(result).not.toHaveProperty('data')
  })

  test('handles primitives, plain objects and absent fields', () => {
    expect(errorDiagnostic('boom')).toEqual({ message: 'boom' })
    expect(errorDiagnostic({ code: 42 })).toEqual({ message: '[object Object]', code: 42 })
  })

  test('reads provider-only fields', () => {
    expect(providerDiagnostic(Object.assign(new Error('provider down'), { providerStatus: 503, reference: 'ref-1', overloaded: true }))).toEqual({
      providerStatus: 503,
      reference: 'ref-1',
      overloaded: true,
      message: 'provider down'
    })
  })
})
