import { POWERSYNC_EVENT_NAMES, POWERSYNC_PHASES } from '@slax-reader/contracts'
import type { PowerSyncEventProperties } from '@slax-reader/contracts'

const phases: PowerSyncEventProperties[] = POWERSYNC_PHASES.map(phase => ({ observation_id: 'obs', phase, outcome: 'success' }))
const failure: PowerSyncEventProperties = { observation_id: 'obs', phase: 'upload', outcome: 'failure', duration_ms: 12, step: 'submit', fingerprint: 'abc', ray: '8f2c' }
const names: string[] = [...POWERSYNC_EVENT_NAMES]
// @ts-expect-error phase vocabulary is fixed.
const invalid: PowerSyncEventProperties = { observation_id: 'obs', phase: 'download' }

export { phases, failure, names, invalid }
