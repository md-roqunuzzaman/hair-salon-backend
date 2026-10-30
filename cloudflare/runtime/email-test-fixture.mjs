import bcrypt from 'bcryptjs';
// External-provider mocks. Imported only by the integration entry point.
const mock = { installed: false, mode: {}, requests: [], smtp: [] };
let onData;
export const setEmailMockOnData = callback => { onData = callback; };
export function emailMockSocket(address, options) {
  const record = { host: address.hostname, port: address.port, tls: options.secureTransport, stage: 'CONNECT' };
  mock.smtp.push(record);
  if (mock.mode.smtp === 'connect') throw Object.assign(new Error('private connection diagnostic'), { code: 'ESOCKET', command: 'CONN' });
  const failure = mock.mode.smtp === 'auth';
  const ambiguous = mock.mode.smtp === 'uncertain';
  const replies = ['220 Ready\r\n', '250-test\r\n250 AUTH LOGIN\r\n', '334 User\r\n', '334 Pass\r\n', failure ? '535 private authentication detail\r\n' : '235 OK\r\n',
    ...(!failure ? ['250 Sender\r\n', mock.mode.smtp === 'reject' ? '550 Recipient rejected\r\n' : mock.mode.smtp === 'temporary' ? '451 Try later\r\n' : '250 Recipient\r\n', '354 Data\r\n', ...(!ambiguous ? ['250 Queued\r\n'] : [])] : [])];
  const readable = new ReadableStream({ start(controller) { for (const line of replies) controller.enqueue(new TextEncoder().encode(line)); controller.close(); } });
  return { opened: mock.mode.smtp === 'tls' ? Promise.reject(Object.assign(new Error('private TLS detail'), { code: 'CERT_HAS_EXPIRED' })) : Promise.resolve({}),
    readable, writable: new WritableStream({ async write(value) {
      const text = new TextDecoder().decode(value);
      const otp = text.replace(/=\r?\n/g, '').match(/class=(?:3D)?"otp">(\d{6})/);
      if (otp) record.otp = otp[1];
      if (text.startsWith('MAIL FROM:')) record.from = text.trim();
      if (text.startsWith('RCPT TO:')) record.to = text.trim();
      if (text.startsWith('AUTH')) record.stage = 'AUTH';
      if (text === 'DATA\r\n') { record.stage = 'SEND'; const callback = onData; onData = undefined; if (callback) await callback(); }
    } }), closed: Promise.resolve(), async close() {} };
}
export async function emailTestControl(db, sessions, body) {
  if (body.seedCustomer) return {success:true,data:await db.user.create({ data: { name:'Existing synthetic customer', email:body.seedCustomer, passwordHash:await bcrypt.hash('StrongPassword123!',10), emailVerified:true, role:'CUSTOMER' } })};
  if (!mock.installed) {
    mock.installed = true;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (!['api.resend.com', 'login.microsoftonline.com', 'graph.microsoft.com'].includes(url.hostname)) return originalFetch(input, init);
      const content = init.body ? String(init.body) : '';
      let data = {}; try { data = JSON.parse(content); } catch { /* OAuth form */ }
      const form = new URLSearchParams(content);
      mock.requests.push({ host: url.hostname, path: url.pathname, method: init.method || 'GET',
        grant: form.get('grant_type'), pkce: !!form.get('code_verifier'), scope: form.get('scope'),
        to: data.to || data.message?.toRecipients?.map(r => r.emailAddress.address), from: data.from,
        multipart: url.hostname === 'graph.microsoft.com' && url.pathname.endsWith('/sendMail') ? /multipart\/alternative/i.test(Buffer.from(content,'base64').toString()) : undefined });
      if (mock.mode.http === 'network') throw new Error('private provider failure');
      if (mock.mode.http === 'rate') return Response.json({ message: 'private provider body' }, { status: 429 });
      if (url.hostname === 'api.resend.com') {
        if (url.pathname === '/emails') {
          if (mock.mode.rotateDuringSend) await db.brandEmailSetting.updateMany({ where: { provider: 'RESEND' }, data: { configurationVersion: { increment: 1 }, isVerified: false } });
          return Response.json({ id: 'email_mock_accepted' });
        }
        if (url.pathname === '/domains' && init.method === 'POST') return Response.json({ id: 'domain_mock' });
        if (url.pathname === '/domains') return Response.json({ data: mock.mode.existingDomain ? [{id:'domain_mock',name:mock.mode.domain || 'salon.example'}] : [], has_more:false });
        if (url.pathname === '/domains/domain_mock/verify') return Response.json({ id: 'domain_mock' });
        if (url.pathname === '/domains/domain_mock') return Response.json({ id: 'domain_mock', name: mock.mode.domain || 'salon.example', status: mock.mode.domainVerified ? 'verified' : 'pending',
          capabilities: { sending: 'enabled' }, records: [{ record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'public-dns-value', status: mock.mode.domainVerified ? 'verified' : 'pending' }] });
      }
      if (url.hostname === 'login.microsoftonline.com') {
        if (mock.mode.refreshInvalid && form.get('grant_type') === 'refresh_token') return Response.json({ error: 'invalid_grant', error_description: 'private token detail' }, { status: 400 });
        return Response.json({ token_type: 'Bearer', access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_in: mock.mode.expiresIn || 3600, scope: 'User.Read Mail.Send' });
      }
      if (url.hostname === 'graph.microsoft.com') {
        if (url.pathname === '/v1.0/me') return Response.json({ id: 'account_mock', mail: mock.mode.identity || 'owner@tenant.example' });
        if (url.pathname === '/v1.0/me/sendMail') return mock.mode.graphUnauthorized ? Response.json({ error:'private token error' }, {status:401}) : new Response(null, { status: 202 });
      }
      return Response.json({ error: 'unknown mock request' }, { status: 400 });
    };
  }
  if (body.mode) mock.mode = body.mode;
  if (body.resetRate) {
    // The mock environment has a disposable Durable Object session store.
    await sessions.eval('return redis.call("SCAN")', { keys: [], arguments: ['merchant-email-rate:*'] });
  }
  if (body.expireOAuth) await sessions.eval('return redis.call("SCAN")', { keys: [], arguments: ['merchant-email-oauth:*'] });
  if (body.resetAuth) await sessions.eval('return redis.call("SCAN")', { keys: [], arguments: ['password-reset-*'] });
  if (body.addBrand) mock.extraBrand = (await db.brand.create({ data: { name:'Other synthetic tenant' } })).id;
  if (body.removeBrand && mock.extraBrand) { await db.brand.delete({ where: { id:mock.extraBrand } }); mock.extraBrand = undefined; }
  const brand = await db.brand.findFirst();
  if (body.flags) await db.brandEmailSetting.update({ where:{brandId:brand.id},data:body.flags });
  const authKey = `password-reset-otp:${brand.id}:${body.authEmail ?? 'book-now-customer@example.com'}`;
  const verificationKey = `email-verification-otp:${brand.id}:${body.authEmail ?? 'book-now-customer@example.com'}`;
  const latestOtp = mock.smtp.findLast(record => record.otp && record.to?.includes(`<${body.authEmail ?? 'book-now-customer@example.com'}>`))?.otp ?? null;
  if (body.resetVerification) await sessions.eval('return redis.call("SCAN")', {keys:[],arguments:['email-verification-*']});
  if (body.expireVerification) await sessions.del(verificationKey);
  if (body.clearVerificationCooldown) await sessions.del(`email-verification-resend:${brand.id}:${body.authEmail}`);
  if (body.clearAuthCooldown) await sessions.del(`password-reset-resend:${brand.id}:${body.authEmail ?? 'book-now-customer@example.com'}`);
  if (body.expireAuthOtp) await sessions.del(authKey);
  const setting = await db.brandEmailSetting.findUnique({ where: { brandId: brand.id } });
  if (body.seedOutbox) await db.emailOutbox.create({ data: { brandId: brand.id, eventType: 'TEST_ONLY', idempotencyKey: 'email-config-pending', recipientEmail: 'mock@example.com', subject: 'Not sent', html: 'Not sent' } });
  return { brandId: brand.id, requests: mock.requests, smtp: mock.smtp,
    auth: { otp:await sessions.get(authKey) ? latestOtp : null, hash:await sessions.get(authKey), ttl:await sessions.ttl(authKey) },
    verification: { otp:await sessions.get(verificationKey) ? latestOtp : null, hash:await sessions.get(verificationKey), ttl:await sessions.ttl(verificationKey), lock:await sessions.get(`email-verification-lock:${brand.id}:${body.authEmail}`) },
    encryptedAtRest: !setting || (!setting.encryptedCredential || setting.encryptedCredential.startsWith('v1:')) && (!setting.oauthDataEncrypted || setting.oauthDataEncrypted.startsWith('v1:')),
    outbox: await db.emailOutbox.findMany({ select: { status: true } }) };
}
