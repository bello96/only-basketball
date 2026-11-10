// 音效体检：把每个音效离线渲染出来，量峰值、响度，以及手机小扬声器听得到的那部分（300Hz 以上）。
// 用法：npm run dev 之后在浏览器控制台里执行
//   (await import('/tools/audio-probe.js')).default().then(console.table)
// 关注三件事：clipped 必须是 0（不破音）；撞击声的 phoneRmsDb 不要比提示音低太多；bad 必须是 0。
export default async () => {
  const Sound = window.__app.sound.constructor;
  const sr = 48000;
  const render = async (fn, seconds = 1.4) => {
    class Ctx extends OfflineAudioContext {
      constructor() {
        super(1, Math.ceil(sr * seconds), sr);
      }
      get state() {
        return 'running';
      }
    }
    const saved = window.AudioContext;
    window.AudioContext = Ctx;
    const s = new Sound();
    s.unlock();
    window.AudioContext = saved;
    fn(s);
    const buf = await s.ctx.startRendering();
    const d = buf.getChannelData(0);
    // 二阶高通（两级一阶，截止 300Hz）粗略模拟手机小扬声器
    const rc = 1 / (2 * Math.PI * 300);
    const k = rc / (rc + 1 / sr);
    const hp = new Float32Array(d.length);
    let y1 = 0, x1 = 0, y2 = 0, x2 = 0;
    for (let i = 0; i < d.length; i++) {
      y1 = k * (y1 + d[i] - x1);
      x1 = d[i];
      y2 = k * (y2 + y1 - x2);
      x2 = y1;
      hp[i] = y2;
    }
    let peak = 0, phonePeak = 0, first = -1, last = -1, bad = 0, over = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (!Number.isFinite(a)) { bad++; continue; }
      if (a > peak) peak = a;
      if (a >= 0.999) over++;
      if (Math.abs(hp[i]) > phonePeak) phonePeak = Math.abs(hp[i]);
      if (a > 0.003) { if (first < 0) first = i; last = i; }
    }
    let sum = 0, phoneSum = 0;
    const n = Math.max(1, last - first + 1);
    for (let i = Math.max(0, first); i <= last; i++) { sum += d[i] * d[i]; phoneSum += hp[i] * hp[i]; }
    const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -99);
    return {
      peak: +peak.toFixed(3),
      peakDb: db(peak),
      rmsDb: db(Math.sqrt(sum / n)),
      phoneRmsDb: db(Math.sqrt(phoneSum / n)),
      ms: first < 0 ? 0 : Math.round(((last - first) / sr) * 1000),
      clipped: over,
      bad,
    };
  };
  const hit = (type, speed, kindA, kindB) => ({ type, speed, x: 0, y: 0, a: 0, b: 1, kindA, kindB });
  const out = {};
  out['篮球落轨 1m/s'] = await render((s) => s.impact(hit('rail', 1, 'basketball')));
  out['篮球落轨 3m/s'] = await render((s) => s.impact(hit('rail', 3, 'basketball')));
  out['篮球落轨 6m/s'] = await render((s) => s.impact(hit('rail', 6, 'basketball')));
  out['排球落轨 3m/s'] = await render((s) => s.impact(hit('rail', 3, 'volleyball')));
  out['球碰球 3m/s'] = await render((s) => s.impact(hit('ball', 3, 'volleyball', 'basketball')));
  out['磕筐沿 3m/s'] = await render((s) => s.impact(hit('dot', 3, 'basketball')));
  out['一堆球同时落地(6个,4m/s)'] = await render((s) => {
    for (let i = 0; i < 6; i++) s.impact(hit(i % 2 ? 'rail' : 'ball', 4, i % 2 ? 'basketball' : 'volleyball', 'volleyball'));
  });
  out['最坏情况(6个落轨,8m/s,加进球)'] = await render((s) => {
    for (let i = 0; i < 6; i++) s.impact(hit('rail', 8, 'basketball'));
    s.swish();
    s.win();
  });
  out['入网'] = await render((s) => s.swish());
  out['胜利'] = await render((s) => s.win());
  out['哨声'] = await render((s) => s.whistle());
  out['篮球出界'] = await render((s) => s.miss());
  out['排球出界'] = await render((s) => s.drop());
  out['按钮'] = await render((s) => s.click());
  return out;
};
