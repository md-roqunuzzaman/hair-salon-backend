export function applyMigrations(storage, migrations) {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS _Migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  const applied = storage.sql.exec('SELECT version, checksum FROM _Migrations ORDER BY version').toArray();
  for (let index = 0; index < applied.length; index++) {
    const expected = migrations[index];
    if (!expected || applied[index].version !== expected.version || applied[index].checksum !== expected.checksum) {
      throw new Error('Database migration mismatch; applied migrations must remain immutable');
    }
  }
  for (const migration of migrations.slice(applied.length)) {
    storage.transactionSync(() => {
      storage.sql.exec(migration.sql);
      storage.sql.exec('INSERT INTO _Migrations VALUES (?, ?)', migration.version, migration.checksum);
    });
  }
}
