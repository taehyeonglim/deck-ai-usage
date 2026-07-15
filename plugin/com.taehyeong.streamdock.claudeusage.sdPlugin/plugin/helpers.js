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
  const api = { ringColor, isStaleData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CU = api;
})(typeof self !== 'undefined' ? self : this);
