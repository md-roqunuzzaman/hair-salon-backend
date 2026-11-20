export function applyMigrations(storage, migrations) {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS _Migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  const applied = storage.sql.exec('SELECT version, checksum FROM _Migrations ORDER BY version').toArray();
  const mismatches = [];
  for (let index = 0; index < applied.length; index++) {
    const expected = migrations[index];
    if (!expected || applied[index].version !== expected.version || applied[index].checksum !== expected.checksum) {
      // Migration checksums identify schema history, not credentials or rows.
      // Expose only this bounded metadata to operator logs so a failed object
      // can be repaired by restoring its historical source, never its ledger.
      const version = Number.isSafeInteger(applied[index].version) ? applied[index].version : 'invalid';
      const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : 'invalid';
      mismatches.push({ version, stored: checksum(applied[index].checksum), bundled: expected ? checksum(expected.checksum) : 'missing' });
    }
  }
  if (mismatches.length) {
    const first = mismatches[0];
    const error = new Error(`Database migration mismatch at version ${first.version}; stored=${first.stored}; bundled=${first.bundled}; mismatches=${JSON.stringify(mismatches)}; applied migrations must remain immutable`);
    error.code = 'MIGRATION_HISTORY_MISMATCH';
    throw error;
  }
  for (const migration of migrations.slice(applied.length)) {
    storage.transactionSync(() => {
      storage.sql.exec(migration.sql);
      storage.sql.exec('INSERT INTO _Migrations VALUES (?, ?)', migration.version, migration.checksum);
    });
  }
}
