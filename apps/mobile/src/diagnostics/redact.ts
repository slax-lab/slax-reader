import {getDataErrorDiagnostic} from '../data/transport-errors.ts';
import type {DiagnosticError} from '../domain/diagnostics.ts';

export function redactError(error: unknown): DiagnosticError | null {
  if (error === null || error === undefined) return null;
  try {
    const diagnostic = getDataErrorDiagnostic(error), value = typeof error === 'object' ? error as Record<string, unknown> : {};
    const name = error instanceof Error ? error.name : typeof value.class === 'string' ? value.class : 'UnknownError';
    const result: DiagnosticError = {class: /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(name) ? name : 'UnknownError'};
    if (typeof value.domain === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(value.domain)) result.domain = value.domain;
    if (typeof value.code === 'number' && Number.isFinite(value.code)) result.code = value.code;
    else if (diagnostic.code !== 'unknown') result.code = diagnostic.code;
    const status = diagnostic.status ?? value.status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) result.status = status;
    return result;
  } catch {return {class: 'UnknownError'};}
}
