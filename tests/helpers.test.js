const test = require('node:test');
const assert = require('node:assert');
const CU = require('../plugin/com.taehyeong.streamdock.claudeusage.sdPlugin/plugin/helpers.js');

test('ringColor thresholds', () => {
  assert.equal(CU.ringColor(51), '#3FB950'); // >50 초록
  assert.equal(CU.ringColor(50), '#D29922'); // 경계=주황
  assert.equal(CU.ringColor(20), '#D29922'); // >=20 주황
  assert.equal(CU.ringColor(19), '#F85149'); // <20 빨강
});

test('isStaleData: flag OR file age', () => {
  const now = 1_000_000_000_000;
  assert.equal(CU.isStaleData({ stale: true, ts: now / 1000 }, now), true);
  assert.equal(CU.isStaleData({ stale: false, ts: now / 1000 }, now), false);
  assert.equal(CU.isStaleData({ stale: false, ts: now / 1000 - 100 }, now), true); // 100s>90s
});

test('pickMetric: 신 키 우선, 없으면 구 키 폴백', () => {
  const u = { gemini_5h: { rem: 80 }, gemini: { rem: 42 } };
  assert.deepEqual(CU.pickMetric(u, { key: 'gemini_5h', fallbackKey: 'gemini' }), { rem: 80 });
});

test('pickMetric: 신 키 부재 시 구 키 (구 writer 스큐)', () => {
  const u = { gemini: { rem: 42 } };
  assert.deepEqual(CU.pickMetric(u, { key: 'gemini_5h', fallbackKey: 'gemini' }), { rem: 42 });
});

test('pickMetric: 둘 다 없으면 null', () => {
  assert.equal(CU.pickMetric({}, { key: 'gemini_5h', fallbackKey: 'gemini' }), null);
  assert.equal(CU.pickMetric(null, { key: 'gemini_5h' }), null);
  assert.equal(CU.pickMetric({ a: 1 }, null), null);
});

test('pickMetric: fallbackKey 없는 지표는 그대로', () => {
  assert.deepEqual(CU.pickMetric({ claude_5h: { rem: 5 } }, { key: 'claude_5h' }), { rem: 5 });
  assert.equal(CU.pickMetric({}, { key: 'claude_5h' }), null);
});
