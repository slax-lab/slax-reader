// Published only in the release that first finds an MCP namespace: the old Edge still binds Core's namespace, so
// Core keeps exporting the stub until Edge stops binding it and the release's second Core publication deletes it.
export { default } from '../core'
export * from '../core'
export { SlaxMcpServer } from '../retired'
