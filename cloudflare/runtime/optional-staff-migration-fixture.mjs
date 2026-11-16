import { applyMigrations } from './migrations.mjs';

// This fixture runs in the minimal SQLite Worker without Node compatibility.
const assert = {
  equal(actual, expected, message = 'Optional-staff migration assertion failed') {
    if (actual !== expected) throw new Error(message);
  },
  deepEqual(actual, expected, message) { this.equal(JSON.stringify(actual), JSON.stringify(expected), message); },
  throws(callback) {
    try { callback(); } catch { return; }
    throw new Error('Expected optional-staff migration constraint/failure');
  },
};

export function verifyOptionalStaffUpgrade(storage, migrations) {
  const sql = (query, ...args) => storage.sql.exec(query, ...args);
  sql("INSERT INTO Staff (id,userId,name,email,roleTitle,updatedAt) VALUES ('portfolio-staff','customer','Upgrade staff','upgrade-staff@example.com','Stylist',1)");
  sql("INSERT INTO Appointment (id,orderNumber,customerId,branchId,staffId,bookingMethod,appointmentStatus,paymentStatus,date,startTime,endTime,price,durationMinutes,itemName,updatedAt,timezone,depositPercentage,depositAmount,remainingAmount,cancellationPolicySnapshot) VALUES ('staff-upgrade','STAFF1','customer','branch','portfolio-staff','DEPOSIT','CONFIRMED','PAID',1,'09:00','10:00',12345,60,'Historical appointment',1,'Asia/Hong_Kong',1000,1234,11111,'{\"version\":1}')");
  sql("UPDATE Payment SET appointmentId='staff-upgrade' WHERE id='legacy-payment'");
  sql("INSERT INTO Review (id,customerId,appointmentId,branchId,staffId,rating,comment,replyText,updatedAt) VALUES ('staff-review','customer','staff-upgrade','branch','portfolio-staff',5,'Historical review','Historical reply',1)");
  sql("INSERT INTO ReviewImage (id,reviewId,objectKey) VALUES ('staff-review-image','staff-review','reviews/history.jpg')");
  const tables = sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(row => row.name);
  const rows = () => JSON.stringify(tables.map(name => [name, sql(`SELECT * FROM "${name}"`).toArray().map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort()))).sort()]));
  const schema = () => JSON.stringify(sql("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").toArray());
  const before = rows();
  const beforeSchema = schema();
  const triggers = () => sql("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='Appointment' ORDER BY name").toArray();
  const beforeTriggers = triggers();
  // Fail after the destructive parent-table replacement, then at the very end.
  for (const broken of [migrations[40].sql.replace('ALTER TABLE "_AppointmentStaffOptional"', 'SELECT * FROM deliberately_missing_staff_table; ALTER TABLE "_AppointmentStaffOptional"'), migrations[40].sql + '; SELECT * FROM deliberately_missing_staff_table;']) {
    assert.throws(() => applyMigrations(storage, [...migrations.slice(0,40), { ...migrations[40], sql: broken }]));
    assert.equal(rows(), before, 'failed upgrade must restore all application rows and ledger');
    assert.equal(schema(), beforeSchema, 'failed upgrade must restore tables, indexes and triggers');
  }
  applyMigrations(storage, migrations);
  assert.equal(sql('PRAGMA table_info(Appointment)').toArray().find(c => c.name === 'staffId').notnull, 0);
  assert.deepEqual(triggers(), beforeTriggers, 'all monetary and required-order-number triggers must survive');
  // Compare every application row; only the migration ledger is expected to change.
  const ledger = sql('SELECT * FROM _Migrations WHERE version=41').one();
  sql('DELETE FROM _Migrations WHERE version=41');
  assert.equal(rows(), before);
  sql('INSERT INTO _Migrations (version,checksum) VALUES (?,?)', ledger.version, ledger.checksum);
  sql("UPDATE Appointment SET staffId=NULL WHERE id='staff-upgrade'");
  sql("INSERT INTO Appointment (id,orderNumber,customerId,branchId,bookingMethod,appointmentStatus,paymentStatus,date,startTime,endTime,price,durationMinutes,itemName,updatedAt) VALUES ('unassigned','STAFF2','customer','branch','RESERVE_NOW','RESERVED','UNPAID',1,'11:00','12:00',100,60,'Unassigned',1)");
  assert.equal(sql("SELECT staffId FROM Appointment WHERE id='unassigned'").one().staffId, null);
  sql("UPDATE Appointment SET staffId='portfolio-staff' WHERE id='unassigned'");
  assert.throws(() => sql("UPDATE Appointment SET staffId='missing' WHERE id='unassigned'"));
  assert.throws(() => sql("DELETE FROM Staff WHERE id='portfolio-staff'"));
  for (const [field, invalid] of [['price',1.5],['price',10000000000],['depositPercentage',100000],['depositAmount',1.5],['remainingAmount',10000000000]]) {
    assert.throws(() => sql(`UPDATE Appointment SET "${field}"=? WHERE id='unassigned'`, invalid));
  }
  assert.throws(() => sql("UPDATE Appointment SET orderNumber=NULL WHERE id='unassigned'"));
  assert.throws(() => sql("UPDATE Appointment SET orderNumber='STAFF1' WHERE id='unassigned'"));
  const after = rows();
  applyMigrations(storage, migrations);
  assert.equal(rows(), after, 'repeat startup must preserve rows and ledger');
  assert.equal(sql('PRAGMA foreign_key_check').toArray().length, 0);
  assert.equal(sql("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '_StaffOptional%' OR name='_AppointmentStaffOptional'").one().n, 0);
  // The original Review -> ReviewImage cascade must still work after restoration.
  sql("DELETE FROM Review WHERE id='staff-review'");
  assert.equal(sql("SELECT count(*) AS n FROM ReviewImage WHERE id='staff-review-image'").one().n, 0);
}
