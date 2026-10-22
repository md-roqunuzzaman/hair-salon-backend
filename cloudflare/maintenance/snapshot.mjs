import { pack } from './codec.mjs';
export const quote = name => '"' + name.replaceAll('"','""') + '"';
export function sqlSnapshot(storage) {
  const schema = storage.sql.exec("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__cf_%' ORDER BY type,name").toArray();
  if (schema.some(s => /CREATE\s+VIRTUAL\s+TABLE|AUTOINCREMENT/i.test(s.sql))) throw Error('UNSUPPORTED_SCHEMA');
  const tables = schema.filter(s => s.type === 'table').map(s => {
    const columns = storage.sql.exec(`PRAGMA table_info(${quote(s.name)})`).toArray();
    if (!columns.length) throw Error('INVALID_TABLE');
    const projection = columns.flatMap(c => {
      const q = quote(c.name);
      return [`typeof(${q})`, `CASE WHEN typeof(${q})='integer' THEN CAST(${q} AS TEXT) ELSE ${q} END`];
    });
    const keys = columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>quote(c.name));
    const rows = [...storage.sql.exec(`SELECT ${projection.join(',')} FROM ${quote(s.name)} ORDER BY ${keys.length ? keys.join(',') : 'rowid'}`).raw()].map(row => columns.map((_,i) => [row[2*i],pack(row[2*i+1])]));
    return { name:s.name, columns:columns.map(c=>c.name), rows };
  });
  if (storage.sql.exec('PRAGMA foreign_key_check').toArray().length) throw Error('DATABASE_FOREIGN_KEYS_FAILED');
  return { schema,tables };
}
export async function capture(storage, identity) {
  // No caller-provided SQL; all generated identifiers originate in sqlite_master.
  const before = await storage.getCurrentBookmark();
  // Synchronous SQL reads do not yield to another object event. Do not open a
  // storage transaction: even an empty commit can advance the recovery log.
  const read=async()=>{
    const sql=sqlSnapshot(storage),kv=[];
    let startAfter;
    for (;;) {
      const batch=await storage.list({limit:128,...(startAfter===undefined?{}:{startAfter})});
      for(const [key,value] of batch)kv.push([key,pack(value)]);
      if(batch.size<128)break;
      startAfter=[...batch.keys()].at(-1);
    }
    return {...sql,kv};
  };
  const state=await read();
  if(JSON.stringify(state)!==JSON.stringify(await read()))throw Error('STORAGE_CHANGED_DURING_EXPORT');
  const after = await storage.getCurrentBookmark();
  // Bookmarks can advance without a data change. With the write-free maintenance
  // implementation active, two matching reads verify data consistency instead.
  return { format:'ABC_DO_BACKUP_V1', identity, bookmark:after, bookmarkBefore:before, consistency:'DOUBLE_READ_MATCH', capturedAt:new Date().toISOString(), ...state };
}
