import MailComposer from 'nodemailer/lib/mail-composer/index.js';

// Implicit TLS only: credentials are never sent over a plaintext connection.
export async function sendSmtpEmail(connect, env, message, { verifyOnly = false } = {}) {
  const host = env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(env.SMTP_PORT || 465);
  if (port !== 465 || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.EMAIL_SENDER) {
    throw new Error('SMTP requires port 465, SMTP_USER, SMTP_PASSWORD and EMAIL_SENDER');
  }
  const mail = new MailComposer({ ...message, from: env.EMAIL_SENDER, disableFileAccess: true, disableUrlAccess: true }).compile();
  const envelope = mail.getEnvelope();
  for (const address of [envelope.from, ...envelope.to]) {
    if (!address || /[\r\n<>]/.test(address)) throw new Error('Invalid SMTP envelope');
  }
  if (!envelope.to.length) throw new Error('Missing SMTP recipient');
  const raw = await new Promise((resolve, reject) => mail.build((error, value) => error ? reject(error) : resolve(value.toString('utf8'))));
  const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
  socket.closed?.catch(() => {});
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = '';
  let accepted = false;
  let stage = 'CONNECT';
  let deliveryUncertain = false;
  let timeoutReject;
  const timeout = new Promise((_, reject) => { timeoutReject = reject; });
  // Also consumed while no I/O is pending, so timeout rejection is never unhandled.
  timeout.catch(() => {});
  const timer = setTimeout(() => {
    const error = Object.assign(new Error('SMTP operation timed out'), { code: 'ETIMEDOUT', stage, deliveryUncertain });
    timeoutReject(error);
    socket.close().catch(() => {});
  }, 30000);
  async function reply(expected) {
    let size = 0;
    while (true) {
      const newline = buffer.indexOf('\r\n');
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        size += line.length;
        if (size > 65536 || !/^\d{3}[ -]/.test(line)) throw new Error('Invalid SMTP response');
        if (line[3] === '-') continue;
        const code = Number(line.slice(0, 3));
        if (!expected.includes(code)) {
          const error = new Error(`SMTP command failed (${code})`);
          error.code = `SMTP_${code}`;
          error.responseCode = code;
          if (code >= 400 && code <= 599) error.deliveryUncertain = false;
          throw error;
        }
        return;
      }
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) throw new Error('SMTP connection closed');
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 65536) throw new Error('SMTP response too large');
    }
  }
  async function command(value, expected) {
    await Promise.race([writer.write(new TextEncoder().encode(value + '\r\n')), timeout]);
    await reply(expected);
  }
  try {
    if (socket.opened) { stage = 'TLS'; await Promise.race([socket.opened, timeout]); }
    stage = 'CONNECT';
    await reply([220]);
    await command('EHLO salon.invalid', [250]);
    stage = 'AUTH';
    await command('AUTH LOGIN', [334]);
    await command(Buffer.from(env.SMTP_USER).toString('base64'), [334]);
    await command(Buffer.from(env.SMTP_PASSWORD).toString('base64'), [235]);
    if (verifyOnly) return { messageId: null, accepted: [] };
    stage = 'SEND';
    await command(`MAIL FROM:<${envelope.from}>`, [250]);
    for (const address of envelope.to) await command(`RCPT TO:<${address}>`, [250, 251]);
    await command('DATA', [354]);
    deliveryUncertain = true;
    await command(raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..').replace(/\r\n$/, '') + '\r\n.', [250]);
    accepted = true;
    return { messageId: mail.messageId(), accepted: envelope.to };
  } catch (error) {
    // Never attach SMTP replies or credentials to diagnostics.
    error.stage ??= stage;
    error.deliveryUncertain ??= deliveryUncertain;
    throw error;
  } finally {
    clearTimeout(timer);
    // A server accepting DATA is success even if connection teardown fails.
    // DATA acceptance is final. Do not wait for a QUIT reply or retry on teardown.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    writer.releaseLock();
    await socket.close().catch(() => {});
  }
}
