import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.ts';
import { fixture, checks } from './checks.mjs';

test('Admin orders execute against disposable local PostgreSQL', async t => {
  const bin = 'C:/Program Files/PostgreSQL/18/bin';
  await mkdir('dist', { recursive: true });
  const directory = await mkdtemp(path.resolve('dist/admin-order-pg-'));
  const data = path.join(directory, 'data');
  const password = randomBytes(24).toString('hex');
  const pwfile = path.join(directory, 'password');
  await writeFile(pwfile, password, { mode: 0o600 });
  const command = (exe, args, detachedOutput = false) => {
    const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, ...(detachedOutput ? { stdio: 'ignore' } : {}) });
    assert.equal(r.status, 0, r.error?.message ?? r.stderr ?? 'Local PostgreSQL tool failed');
    return r.stdout;
  };
  command(path.join(bin, 'initdb.exe'), ['-D', data, '-U', 'admin_order_test', '--pwfile=' + pwfile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  command(path.join(bin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], true);
  let client, db;
  t.after(async () => {
    await db?.$disconnect(); await client?.end();
    command(path.join(bin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], true);
  });
  const connection = { host: '127.0.0.1', port, user: 'admin_order_test', password, database: 'postgres' };
  client = new pg.Client(connection); await client.connect();
  const schema = command(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--config', 'cloudflare/node-client.config.ts', '--from-empty', '--to-schema', 'prisma/schema', '--script']);
  await client.query(schema);
  db = new PrismaClient({ adapter: new PrismaPg(connection) });
  const f = await fixture(db);
  const results = await checks(db, 'postgresql', f);
  for (const r of results) await t.test(r.name, () => assert.equal(r.pass, true, r.error));
});
