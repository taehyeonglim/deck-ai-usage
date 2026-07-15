// time/interval.js 패턴: 메인스레드 타이머 지연 회피. name별 다중 타이머 지원
// ("data" 30초 데이터 갱신 / "anim" 100ms 캐릭터 애니메이션).
const timers = {};
self.onmessage = ({ data }) => {
  const name = data.name || 'default';
  if (data.event === 'start') {
    if (timers[name]) return;
    timers[name] = setInterval(() => self.postMessage({ event: 'tick', name }), data.delay);
  } else if (data.event === 'stop') {
    clearInterval(timers[name]);
    delete timers[name];
  }
};
