// Published only by topology:transition steps 2 and 3: Edge still binds MCP_OBJECT to this namespace until its
// slim version is live, so Core keeps exporting the stub until step 4 deletes the namespace.
export { default } from '../core'
export * from '../core'
export { SlaxMcpServer } from '../retired'
