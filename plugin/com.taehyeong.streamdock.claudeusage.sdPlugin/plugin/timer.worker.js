// time/interval.js 패턴: 메인스레드 타이머 지연 회피
let id = null;
self.onmessage = ({ data }) => {
  if (data.event === 'start') {
    if (id) return;
    id = setInterval(() => self.postMessage({ event: 'tick' }), data.delay);
  } else if (data.event === 'stop') {
    clearInterval(id); id = null;
  }
};
