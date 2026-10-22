"""Local-only SQLite restore/integrity check. No filesystem database or network access."""
import hashlib
import json
import sqlite3
import sys

def quote(name):
    return '"' + name.replace('"', '""') + '"'

def scalar(cell):
    kind, value = cell
    if kind == 'integer':
        return int(value)
    if kind == 'blob':
        return bytes(value['v'])
    if kind == 'real':
        return float(value['v'])
    if kind == 'null':
        return None
    if kind == 'text':
        return value
    raise ValueError('UNSUPPORTED_SQL_TYPE')

def main():
    with open(sys.argv[1], encoding='utf-8') as source:
        envelope = json.load(source)
    payload = envelope['payload']
    if hashlib.sha256(payload.encode('utf-8')).hexdigest() != envelope['sha256']:
        raise ValueError('BACKUP_HASH_MISMATCH')
    backup = json.loads(payload)
    with sqlite3.connect(':memory:') as db:
        db.execute('PRAGMA foreign_keys = ON')
        db.execute('BEGIN')
        db.execute('PRAGMA defer_foreign_keys = ON')
        for item in backup['schema']:
            if item['type'] == 'table':
                db.execute(item['sql'])
        for table in backup['tables']:
            columns = ','.join(quote(c) for c in table['columns'])
            placeholders = ','.join('?' for _ in table['columns'])
            for row in table['rows']:
                db.execute(f'INSERT INTO {quote(table["name"])} ({columns}) VALUES ({placeholders})', [scalar(c) for c in row])
        for item in backup['schema']:
            if item['type'] != 'table':
                db.execute(item['sql'])
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('FOREIGN_KEY_CHECK_FAILED')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('INTEGRITY_CHECK_FAILED')
    print(json.dumps({'localSqliteIntegrity': True}))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not include SQL, row values, secrets or financial records in diagnostics.
        print('LOCAL_SQLITE_VERIFICATION_FAILED', file=sys.stderr)
        sys.exit(1)
