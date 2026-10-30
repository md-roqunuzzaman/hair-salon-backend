import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { localizeNotification } from '../src/app/module/notification/notification.localization.ts';
import { notificationName } from '../src/app/module/notification/notification.names.ts';
import { notificationTemplates as templates } from '../src/app/module/notification/notification.templates.ts';

const locales = ['en', 'zh-CN', 'zh-HK'];
const rowFor = (type, translations) => ({ type, ...translations.en, translations });

test('the same stored notification switches language without changing stored content', () => {
  const row = rowFor('BOOKING_RESERVED', templates.BOOKING_RESERVED('2026-11-15', '15:00'));
  const before = JSON.stringify(row);
  for (const lang of locales) assert.deepEqual(localizeNotification(row, lang), row.translations[lang]);
  assert.equal(JSON.stringify(row), before);
});

test('all notification templates provide complete English, simplified and traditional copy', () => {
  const args = {
    POLICY_BOOKING_CANCELLED: [true], POLICY_REFUND_COMPLETED: [50, 'HKD', true],
    REFUND_REQUEST_APPROVED: [50, 'HKD'], REFUND_REQUEST_REJECTED: [50, 'HKD', 'Test note'],
    APPOINTMENT_REMINDER: ['2026-11-15', '15:00', 'Haircut'],
    BOOKING_RESERVED: ['2026-11-15', '15:00'], BOOKING_RESCHEDULED: ['2026-11-15', '15:00'],
    BRANCH_STATUS_CHANGED: ['Central', false], BRANCH_UNAVAILABLE: ['Central'],
  };
  for (const [name, factory] of Object.entries(templates)) {
    const translations = factory(...(args[name] ?? [50, 'HKD']));
    for (const lang of locales) {
      for (const field of ['title', 'message']) {
        const value = translations[lang]?.[field];
        assert.equal(typeof value, 'string', `${name}.${lang}.${field}`);
        assert.ok(value.trim());
        assert.doesNotMatch(value, /undefined|NaN|\[object Object\]/);
        if (lang === 'en') assert.doesNotMatch(value, /\p{Script=Han}/u);
        else assert.match(value, /\p{Script=Han}/u);
      }
    }
  }
});

test('previously untranslated wallet, policy, expiry and refund variants render in all locales', () => {
  for (const [type, translations] of [
    ['BOOKING_CONFIRMED', templates.BOOKING_CONFIRMED_SUCCESS()],
    ['BOOKING_CANCELLED', templates.POLICY_BOOKING_CANCELLED(true)],
    ['BOOKING_CANCELLED', templates.POLICY_BOOKING_CANCELLED(false)],
    ['REFUND_COMPLETED', templates.POLICY_REFUND_COMPLETED(42.15, 'HKD')],
    ['REFUND_COMPLETED', templates.POLICY_REFUND_COMPLETED(42.15, 'HKD', true)],
    ['GROUP_PURCHASE_EXPIRED', templates.GROUP_PURCHASE_EXPIRED()],
    ['SYSTEM', templates.REFUND_REQUEST_APPROVED(42.15, 'HKD')],
    ['SYSTEM', templates.REFUND_REQUEST_REJECTED(42.15, 'HKD', 'Original note')],
  ]) {
    const row = { type, ...translations.en };
    for (const lang of locales) assert.deepEqual(localizeNotification(row, lang), translations[lang]);
  }
});

test('partial or duplicate English translations never become Chinese title / English body', () => {
  const translations = templates.BOOKING_RESERVED('2026-11-15', '15:00');
  for (const lang of ['zh-CN', 'zh-HK']) {
    for (const broken of [{ title: translations[lang].title }, translations.en, { message: '' }]) {
      const row = { type: 'BOOKING_RESERVED', ...translations.en, translations: { en: translations.en, [lang]: broken } };
      assert.deepEqual(localizeNotification(row, lang), translations[lang]);
    }
  }
});

test('unknown historical copy uses a localized notice without fabricating financial or scheduling facts', () => {
  for (const type of ['SYSTEM', 'BOOKING_CONFIRMED', 'REFUND_COMPLETED']) {
    const row = { type, title: 'Old custom title', message: 'Custom financial details not recognized', translations: { 'zh-HK': { title: '通知' } } };
    assert.equal(localizeNotification(row, 'en').message, row.message);
    for (const lang of ['zh-CN', 'zh-HK']) {
      const value = localizeNotification(row, lang);
      assert.doesNotMatch(value.title + value.message, /[A-Za-z]|\d/);
      assert.match(value.message, /原始/);
    }
  }
  const row = { type: 'SYSTEM', title: '旧通知', message: '旧内容', translations: null };
  assert.doesNotMatch(JSON.stringify(localizeNotification(row, 'en')), /\p{Script=Han}/u);
});

test('merchant rejection notes stay verbatim while surrounding notification copy is localized', () => {
  const note = 'Original merchant note 原始备注';
  const translations = templates.REFUND_REQUEST_REJECTED(50, 'HKD', note);
  for (const lang of locales) assert.ok(localizeNotification(rowFor('SYSTEM', translations), lang).message.endsWith(note));
});

test('branch and service names use only the requested translation or a localized generic label', () => {
  const names = { en: { name: 'Central' }, 'zh-CN': { name: '中环店' }, 'zh-HK': { name: '中環店' } };
  for (const lang of locales) {
    assert.equal(notificationName(names, lang, 'Other', 'branch'), names[lang].name);
    assert.ok(templates.BRANCH_UNAVAILABLE('Other', names)[lang].message.startsWith(names[lang].name));
    assert.ok(templates.BRANCH_STATUS_CHANGED('Other', false, names)[lang].message.includes(names[lang].name));
  }
  assert.equal(notificationName(undefined, 'en', '理发', 'service'), 'Service');
  assert.equal(notificationName(undefined, 'zh-CN', 'Haircut', 'service'), '服务');
  assert.equal(notificationName(undefined, 'zh-HK', 'Haircut', 'service'), '服務');
});

test('new and historical appointment reminders localize the timezone label', () => {
  const translations = templates.APPOINTMENT_REMINDER('2026-11-15', '15:00', 'Haircut');
  for (const lang of ['zh-CN', 'zh-HK']) {
    const row = rowFor('APPOINTMENT_REMINDER', translations);
    assert.deepEqual(localizeNotification({ ...row, translations: null }, lang), translations[lang]);
    row.translations = { [lang]: { title: translations[lang].title, message: `提醒 (Hong Kong time)` } };
    assert.doesNotMatch(localizeNotification(row, lang).message, /Hong Kong time/);
  }
});

test('legacy team copy localizes titles and avoids importing an item name from a different language', () => {
  const row = { type: 'BOOKING_CREATED', title: 'New booking', message: 'Appointment abc: Haircut, 2026-11-15 at 15:00.', translations: { 'zh-HK': { title: 'New booking' } } };
  const value = localizeNotification(row, 'zh-HK');
  assert.equal(value.title, '新預約');
  assert.match(value.message, /服務/);
  assert.doesNotMatch(value.message, /Haircut/);
  assert.equal(localizeNotification({ ...row, message: row.message.replace('Haircut', '理发'), translations: null }, 'en').message, 'Appointment abc: Service, 2026-11-15 at 15:00.');
});

test('every application notification producer explicitly provides translations', () => {
  let calls = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'notificationService.createNotification') {
          const payload = node.arguments[0];
          assert.ok(ts.isObjectLiteralExpression(payload), `${file}: explicit notification payload required`);
          assert.ok(payload.properties.some(p => p.name?.getText(source) === 'translations'), `${file}: missing translations`);
          calls++;
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk('src/app');
  assert.ok(calls >= 40, `Expected existing producers; found ${calls}`);
});
