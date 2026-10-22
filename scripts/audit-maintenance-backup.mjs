// Local-only audit. Never logs customer, session, payment or wallet records.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unpack } from '../cloudflare/maintenance/codec.mjs';
import migrations from '../cloudflare/.build/migrations.mjs';
const [file, output] = process.argv.slice(2);
if (!file || !output || [file, output].some(p => /^https?:/i.test(p))) throw Error('LOCAL_BACKUP_AND_REPORT_PATHS_REQUIRED');
const envelope = JSON.parse(await readFile(file, 'utf8'));
if (createHash('sha256').update(envelope.payload).digest('hex') !== envelope.sha256) throw Error('BACKUP_HASH_MISMATCH');
const backup = JSON.parse(envelope.payload);
const table = name => backup.tables.find(t => t.name === name);
const records = name => {
  const t = table(name);
  return t ? t.rows.map(row => Object.fromEntries(t.columns.map((c, i) => [c, unpack(row[i][1])]))) : [];
};
const ledger = records('_Migrations');
if (!ledger.length) throw Error('MIGRATION_LEDGER_MISSING');
for (const [i, row] of ledger.entries()) {
  if (Number(row.version) !== migrations[i]?.version || row.checksum !== migrations[i]?.checksum) throw Error('LEDGER_VERSION_OR_CHECKSUM_MISMATCH');
}
const assignments = records('PackageBranch').map(r => ({ packageId: r.packageId, branchId: r.branchId }));
const branches = new Set(records('Branch').map(r => r.id));
const policies = ['GroupPurchaseRefundPolicy', 'GroupPurchaseCancellationPolicy'].flatMap(name => records(name).map(r => {
  const legacy = table(name).columns.includes('packageId');
  const branchId = legacy ? 'f7318524-db7c-49cf-8bc4-bfc6ff5c6b97' : r.branchId;
  const assignedBranches = legacy ? assignments.filter(a => a.packageId === r.packageId).map(a => a.branchId) : [];
  const mapped = branches.has(branchId) && (!legacy || (r.packageId === '9ff78b23-f681-4007-a44c-ef4277decf17' && assignedBranches.includes(branchId)));
  return { module: name, policyId: r.id, version: r.version, legacy, ...(legacy ? { packageId: r.packageId, assignedBranches } : {}), branchId, status: mapped ? 'VALID' : 'REQUIRES_MANUAL_MAPPING' };
}));
const collisions = policies.filter((p, i) => policies.some((q, j) => j !== i && p.module === q.module && p.branchId === q.branchId));
const unresolved = policies.filter(p => p.status !== 'VALID');
const report = {
  sha256: envelope.sha256, capturedAt: backup.capturedAt, identity: backup.identity,
  ledger: ledger.map(r => ({ version: Number(r.version), checksum: r.checksum })),
  pendingVersions: migrations.slice(ledger.length).map(m => m.version),
  assignments, policies, collisionCount: collisions.length, unresolvedCount: unresolved.length,
  rowCounts: Object.fromEntries(backup.tables.map(t => [t.name, t.rows.length])),
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ledgerVersion: Number(ledger.at(-1).version), ledgerChecksumsMatch: true, pendingVersions: report.pendingVersions, packageBranchAssignments: assignments.length, policyCount: policies.length, legacyPolicyCount: policies.filter(p => p.legacy).length, unresolvedMappings: unresolved.length, collisions: collisions.length }));
if (unresolved.length || collisions.length) process.exitCode = 1;
