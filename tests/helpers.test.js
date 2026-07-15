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
