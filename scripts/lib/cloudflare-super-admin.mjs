import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

export function superAdminSettings(env) {
  const settings = {
    name: env.SUPER_ADMIN_NAME?.trim(),
    email: env.SUPER_ADMIN_EMAIL?.trim().toLowerCase(),
    password: env.SUPER_ADMIN_PASSWORD,
    phone: env.SUPER_ADMIN_PHONE?.trim() || null,
    rounds: Number(env.BCRYPT_SALT_ROUNDS || 12),
  };
  if(!settings.name||!settings.email||!settings.password)throw new Error('Super Admin seed credentials are missing');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email))throw new Error('Invalid Super Admin email');
  if(settings.password.length<8||Buffer.byteLength(settings.password,'utf8')>72)throw new Error('Super Admin password must be at least 8 characters and at most 72 UTF-8 bytes');
  if(!Number.isInteger(settings.rounds)||settings.rounds<10||settings.rounds>15)throw new Error('Invalid bcrypt cost');
  return settings;
}

export async function seedCloudflareSuperAdmin({query,settings,apply=false}) {
  const find = async () => (await query('SELECT id,name,email,phone,role,status,passwordHash,emailVerified,mustChangePassword FROM "User" WHERE lower(email)=?',[settings.email]))[0];
  const result = (row,created) => ({created,id:row.id,name:row.name,email:row.email,role:row.role,status:row.status,emailVerified:Boolean(row.emailVerified),mustChangePassword:Boolean(row.mustChangePassword)});
  const existing = await find();
  if(existing) {
    if(existing.role!=='SUPER_ADMIN')throw new Error('Email already belongs to another role; automatic promotion is prohibited');
    if(!await bcrypt.compare(settings.password,existing.passwordHash))throw new Error('Existing Super Admin has a different password; automatic password reset is prohibited');
    return result(existing,false);
  }
  if(settings.phone&&(await query('SELECT id FROM "User" WHERE phone=?',[settings.phone])).length)throw new Error('Phone already belongs to another account');
  if(!apply)return {created:false,wouldCreate:true,name:settings.name,email:settings.email,role:'SUPER_ADMIN'};
  const hash=await bcrypt.hash(settings.password,settings.rounds);
  const now=Date.now();
  const inserted=await query(`INSERT INTO "User" (id,name,email,phone,passwordHash,role,status,emailVerified,emailVerifiedAt,mustChangePassword,createdAt,updatedAt)
    SELECT ?,?,?,?,?,'SUPER_ADMIN','ACTIVE',1,?,0,?,?
    WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE lower(email)=?)
      AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM "User" WHERE phone=?))
    RETURNING id`,[randomUUID(),settings.name,settings.email,settings.phone,hash,now,now,now,settings.email,settings.phone,settings.phone]);
  const saved=await find();
  if(!saved||saved.role!=='SUPER_ADMIN'||!await bcrypt.compare(settings.password,saved.passwordHash))throw new Error('Super Admin creation could not be verified; no existing account was overwritten');
  return result(saved,inserted.length===1);
}
