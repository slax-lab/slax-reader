// Worker 版本：改动实现、协议或加载方式时递增；只影响 Worker URL。
export const POWER_SYNC_WORKER_GENERATION = 'v4'

// 数据库版本：无法安全复用或迁移时递增；会创建 slax-reader-<version>.db。
export const POWER_SYNC_DATABASE_GENERATION = 'v3'

// 数据版本：控制 localStorage 的 dataVersion 闸门。
// 递增会清库和凭据，可能丢失未同步写入；不影响 Worker URL 和 dbFilename。
export const POWER_SYNC_LOCAL_DATA_VERSION = 1
