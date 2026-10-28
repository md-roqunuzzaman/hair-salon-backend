import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSmtpEmail } from './runtime/smtp.mjs';

const env = { SMTP_USER: 'sender@gmail.com', SMTP_PASSWORD: 'private-app-password', EMAIL_SENDER: 'sender@gmail.com' };
function server(replies) {
  const writes = [];
  let closed = false;
  const encoder = new TextEncoder();
  const readable = new ReadableStream({ start(controller) {
    // Deliberately fragmented greeting and multiline EHLO.
    for (const line of replies) controller.enqueue(encoder.encode(line));
    controller.close();
  } });
  return {
    connect(address, options) {
      assert.equal(address.port, 465);
      assert.equal(options.secureTransport, 'on');
      return { readable, writable: new WritableStream({ write(value) { writes.push(new TextDecoder().decode(value)); } }), async close() { closed = true; } };
    }, writes, get closed() { return closed; },
  };
}
test('TLS SMTP authenticates, submits MIME and dot-stuffs body', async () => {
  const smtp = server(['22', '0 Ready\r\n250-smtp\r\n250 AUTH LOGIN\r\n334 Username\r\n334 Password\r\n235 Authenticated\r\n250 Sender\r\n250 Recipient\r\n354 Data\r\n250 Queued\r\n']);
  const result = await sendSmtpEmail(smtp.connect, env, { from: 'ignored@example.com', to: 'customer@example.com', subject: 'Reset OTP', text: '.hello\r\nOTP 123456' });
  assert.deepEqual(result.accepted, ['customer@example.com']);
  assert.match(result.messageId, /@/);
  assert.ok(smtp.writes.includes('MAIL FROM:<sender@gmail.com>\r\n'));
  assert.match(smtp.writes.join(''), /\.\.hello/);
  assert.match(smtp.writes.join(''), /Subject: Reset OTP/);
  assert.equal(smtp.closed, true);
});
test('SMTP authentication failure is sanitized and closes connection', async () => {
  const smtp = server(['220 Ready\r\n250 AUTH LOGIN\r\n334 Username\r\n334 Password\r\n535 private-provider-details\r\n']);
  await assert.rejects(sendSmtpEmail(smtp.connect, env, { to: 'customer@example.com', text: 'OTP' }), error => {
    assert.equal(error.code, 'SMTP_535');
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  assert.equal(smtp.closed, true);
  assert.equal(smtp.writes.some(value => value.startsWith('DATA')), false);
});
test('SMTP rejects missing credentials and plaintext ports before connecting', async () => {
  const connect = () => { throw new Error('must not connect'); };
  await assert.rejects(sendSmtpEmail(connect, { ...env, SMTP_PORT: '25' }, {}), /SMTP requires/);
  await assert.rejects(sendSmtpEmail(connect, { ...env, SMTP_PASSWORD: '' }, {}), /SMTP requires/);
});

test('SMTP connectivity verification never submits DATA or claims message delivery', async () => {
  const smtp = server(['220 Ready\r\n250 AUTH LOGIN\r\n334 User\r\n334 Password\r\n235 Authenticated\r\n']);
  const result = await sendSmtpEmail(smtp.connect, env, { to:'customer@example.com', text:'not sent' }, { verifyOnly:true });
  assert.equal(result.messageId, null);
  assert.equal(smtp.writes.some(value => value.startsWith('DATA')), false);
});

test('SMTP disconnect after DATA is marked uncertain, never accepted', async () => {
  const smtp = server(['220 Ready\r\n250 AUTH LOGIN\r\n334 User\r\n334 Password\r\n235 Authenticated\r\n250 Sender\r\n250 Recipient\r\n354 Data\r\n']);
  await assert.rejects(sendSmtpEmail(smtp.connect, env, {to:'customer@example.com',text:'test'}), error => {
    assert.equal(error.stage,'SEND'); assert.equal(error.deliveryUncertain,true); return true;
  });
});
