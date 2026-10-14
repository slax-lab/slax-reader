/** Same-identity simulator replacement can relocate the preserved application container. */
export function controlledNativeFixturePaths(platform: string, markerRoot: string, originalDatabasePath: string) {
  if (platform === 'android') {
    const databasePaths = ['/data/data/com.slax.reader/databases/powersync.db', '/data/user/0/com.slax.reader/databases/powersync.db'];
    if (!databasePaths.includes(originalDatabasePath)) throw new Error('The original database is outside the Android fixture identity');
    return {databasePaths, cacheRoot: originalDatabasePath.slice(0, -'/databases/powersync.db'.length), containerRelocated: false};
  }
  const uuid = '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}';
  const current = new RegExp(`^(.*/CoreSimulator/Devices/${uuid}/data/Containers/Data/Application/)${uuid}/Library/Application Support$`, 'i').exec(markerRoot);
  if (platform !== 'ios' || !current || !originalDatabasePath.startsWith(current[1]!) || !new RegExp(`^${uuid}/Library/Application Support/databases/powersync\\.db$`, 'i').test(originalDatabasePath.slice(current[1]!.length))) {
    throw new Error('The original database is outside the controlled iOS simulator');
  }
  const databasePath = `${markerRoot}/databases/powersync.db`;
  return {databasePaths: [databasePath], cacheRoot: markerRoot, containerRelocated: originalDatabasePath !== databasePath};
}
