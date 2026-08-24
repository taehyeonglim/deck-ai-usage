(function (root) {
  function ringColor(rem) {
    if (rem > 50) return '#3FB950';
    if (rem >= 20) return '#D29922';
    return '#F85149';
  }
  function isStaleData(data, nowMs, maxAgeSec) {
    if (!data) return true;
    if (data.stale === true) return true;
    const age = maxAgeSec === undefined ? 90 : maxAgeSec;
    if (!data.ts) return false;
    return (nowMs / 1000 - data.ts) > age;
  }
  // 지표 조회 — 신 키가 없으면 구 키로 폴백.
  // writer(NERV)와 플러그인(StreamDock)은 배포 시점이 달라 스키마 스큐가 실재한다.
  function pickMetric(u, metric) {
    if (!u || !metric) return null;
    const d = u[metric.key];
    if (d != null) return d;
    if (!metric.fallbackKey) return null;
    return u[metric.fallbackKey] != null ? u[metric.fallbackKey] : null;
  }
  const api = { ringColor, isStaleData, pickMetric };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CU = api;
})(typeof self !== 'undefined' ? self : this);
