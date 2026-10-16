import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

// Match the native read-only snapshot encoding; no PowerSync extension is loaded.
export function inspectFixture(path) {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    const digest = () => {
      const hash = createHash('sha256');
      return {add(value) {if (value == null) hash.update('-:'); else {const bytes = Buffer.from(String(value)); hash.update(`${bytes.length}:`); hash.update(bytes);}}, finish() {return hash.digest('hex');}};
    };
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'ps_data__*' OR name GLOB 'ps_data_local__*') ORDER BY name").all().map(row => row.name);
    const queue = digest(), data = digest(), local = digest();
    let previousTransaction, pendingOperations = 0, pendingTransactions = 0;
    for (const row of db.prepare('SELECT id,tx_id,data FROM ps_crud ORDER BY id').all()) {
      if (!pendingOperations || previousTransaction !== row.tx_id) pendingTransactions++;
      previousTransaction = row.tx_id; pendingOperations++;
      [row.id, row.tx_id, row.data].forEach(value => queue.add(value));
    }
    for (const table of tables) {
      const isLocal = table.startsWith('ps_data_local__'); data.add(table); if (isLocal) local.add(table);
      for (const row of db.prepare(`SELECT id,data FROM "${table.replaceAll('"', '""')}" ORDER BY id COLLATE BINARY`).all()) {
        [row.id, row.data].forEach(value => {data.add(value); if (isLocal) local.add(value);});
      }
    }
    const integrityRows = db.prepare('PRAGMA quick_check').all();
    return {databasePath: path, integrityValid: integrityRows.length === 1 && Object.values(integrityRows[0])[0] === 'ok', formatVersion: db.prepare('SELECT ifnull(max(id),0) AS version FROM ps_migration').get().version, userVersion: db.prepare('PRAGMA user_version').get().user_version, storageTables: tables, pendingOperations, pendingTransactions, queueDigest: queue.finish(), dataDigest: data.finish(), localDigest: local.finish()};
  } finally {db.close();}
}
