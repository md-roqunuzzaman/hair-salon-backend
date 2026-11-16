// Turn retained baseline TAP failures into a reviewable, per-failure classification.
import { readFile, writeFile } from 'node:fs/promises';
const root = 'node_modules/.cloudflare-test/issue152';
const booking = JSON.parse(await readFile(`${root}/booking-before.json`, 'utf8'));
const api = JSON.parse(await readFile(`${root}/api-before.json`, 'utf8'));
const worker = JSON.parse(await readFile(`${root}/worker-final.json`, 'utf8'));
const classifyBooking = line => {
  const id = Number(line.match(/not ok (\d+)/)[1]);
  if (/^\s/.test(line) || (id >= 25 && id <= 33)) return ['Mock incompatibility', 'Mock required where.status even when absent and discarded returned status; honor the actual Prisma query/projection.'];
  if (id === 15) return ['Outdated test fixture', 'Use a configured INACTIVE stylist to represent no eligible staff; an empty configuration now intentionally allows staff-free booking. Distinct unavailable reasons remain asserted.'];
  return ['Outdated test fixture', 'Configured staff projection omitted ACTIVE status; supply status in the baseline and explicit staff-list overrides. Existing behavior assertions remain unchanged.'];
};
const classifyApi = line => line.includes('My Orders')
  ? ['Outdated test fixture', 'Committed My Orders contract adds quantity. Keep the exact key assertion, add quantity and assert 2 for the linked group purchase and null for other orders.']
  : line.includes('Worker breaks')
    ? ['Outdated test fixture', 'Commit 1da2954 retired DIRECT_BOOK creation. Assert explicit 400 validation plus unchanged state; retain real break rejection and successful boundary redemption for paid vouchers.']
    : ['Outdated test fixture', 'Seed a historical DIRECT_BOOK deposit rather than create a retired flow. Real QR verification, ownership, wallet/Stripe remaining settlement, exact amounts, replay and duplicate-payment checks remain.'];
const table = (lines, classify) => [
  '| Exact baseline TAP failure | Classification | Cause and correction |',
  '| --- | --- | --- |',
  ...lines.map(line => { const [kind, reason] = classify(line); return `| ${line.trim().replaceAll('|','\\|')} | ${kind} | ${reason} |`; }),
].join('\n');
const report = `# Issue #152 regression failure classification

Baseline replay on 2026-11-16 reproduced booking **16 passed / 50 failed / 66 total** and API **43 passed / 5 failed / 48 total**. The tables include every failed TAP entry, including failed parent tests whose children failed; parent entries are not separate root causes. No tests were skipped, deleted or disabled.

## Booking baseline: every failed entry

${table(booking.failures, classifyBooking)}

## API baseline: every failed entry

${table(api.failures, classifyApi)}

## Additional Worker discovery run: every failed entry

The broader Worker run found five further failed TAP entries (including one parent). They all exercised retired DIRECT_BOOK creation. Current voucher redemption now exercises the same component eligibility and all nine cross-product overlap combinations, retaining 409/no-write assertions. The routing test explicitly rejects every retired creation method with 400 and unchanged state, while delisted paid-voucher redemption remains successful. Historical DIRECT_BOOK financial settlement is covered separately by the persisted-deposit fixture.

${table(worker.failures, () => ['Outdated test fixture', 'Use the committed voucher-only purchase/redemption contract. Preserve package eligibility, all nine staff-conflict combinations and unchanged-state assertions; explicitly assert retired creation rejection.'])}

## Real application regressions found by additional tests

1. A date-specific move removed the original branch's persistent assignment from configuration detection and incorrectly exposed NO_STAFF availability. Transactional booking also ignored incoming overrides, so the destination preview could disagree with persisted staff assignment. Preserve persistent configuration and include incoming overrides consistently in both availability and the transaction; use schedules to determine actual availability. The new temporary-branch-move Worker test failed before the fix and passes after it, checking original-branch 409/no writes and destination AUTO/manual assignment.
2. Package configuration detection filtered out assigned stylists missing a required service skill, incorrectly converting an ineligible configured package into a staff-free product. Detect package assignment first, then apply service skills to eligibility. The new configured-package Worker test failed before the fix and passes after it, retaining no slots, 409 and unchanged state.

The original 55 failed TAP entries were fixture/mock compatibility problems; the two application bugs above were found through added regression coverage, not by relaxing the original failures. Current creation remains voucher-only, and historical DIRECT_BOOK remaining-payment behavior remains covered.

Full baseline and final command output, exit codes and summary JSON are retained under \`${root}/\`. See [the release preparation report](optional-appointment-staff-cloudflare.md) for final counts and limits.
`;
await writeFile('docs/issue152-regression-classification.md', report);
console.log(JSON.stringify({ bookingFailureEntries: booking.failures.length, apiFailureEntries: api.failures.length, report: 'docs/issue152-regression-classification.md' }));
