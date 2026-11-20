import { createHash } from 'node:crypto';

// These LF checksums match the applied Salon staging history. Never replace
// them to accept edited SQL; schema changes belong in a new versioned migration.
export const pinnedMigrationChecksums = Object.freeze({
  42: '6b6e3b3e668100a0688a93e0bbc6396f607a7a5dc3ff0b66758a230e5d139940',
  43: '54a5364807d5103307357429b64514f298ac7da942e4cf85f2f501206391207c',
  45: '3d982cd34ada96fe64d0f53d5923b026d914f06f150c79d9d596c5541c628cbb',
});

export function verifyPinnedMigrationHistory(migrations) {
  for (const [version, checksum] of Object.entries(pinnedMigrationChecksums)) {
    const entry = migrations.find(item => item.version === Number(version));
    if (!entry || entry.checksum !== checksum || createHash('sha256').update(entry.sql).digest('hex') !== checksum) {
      throw new Error(`SQLite migration v${version} differs from deployed Salon history. Restore exact historical bytes, including line endings; use a new migration for schema changes. No ledger rewrite is allowed.`);
    }
  }
}
