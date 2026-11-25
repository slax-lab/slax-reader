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

  test('keeps user content out of parse errors and metadata', () => {
    let parseError: unknown
    try {
      JSON.parse('private-bookmark-title')
    } catch (error) {
      parseError = error
    }
    expect(JSON.stringify(errorDiagnostic(parseError))).not.toContain('private')
    expect(errorDiagnostic(parseError)).toMatchObject({ name: 'SyntaxError', message: 'Invalid JSON' })
    const prisma = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { modelName: 'sr_bookmark', target: ['uuid'], value: 'private-note', nested: { body: 'private' } }
    })
    expect(errorDiagnostic(prisma).meta).toEqual({ modelName: 'sr_bookmark', target: ['uuid'] })
  })

  test('never throws for an error whose message or string form throws', () => {
    const hostile = Object.defineProperty(
      {
        toString: () => {
          throw new Error('toString')
        }
      },
      'message',
      {
        get: () => {
          throw new Error('getter')
        }
      }
    )
    expect(providerDiagnostic(hostile)).toEqual({ message: 'Unknown error' })
    expect(errorDiagnostic(hostile)).toEqual({ message: 'Unknown error' })
  })
})
