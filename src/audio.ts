import type { BallKind, Impact } from './physics/world';

/** 同一小段时间内最多叠几个撞击声 */
const MAX_HITS_PER_WINDOW = 4;
const HIT_WINDOW = 0.08;

/**
 * 全部音效都用 WebAudio 现场合成，不加载任何音频文件。
 *
 * 两个设计上的讲究（都是把声音离线渲染出来量过之后定的）：
 * - 撞击声除了球体的低频闷响，还带一层 300Hz 以上的"笃"声。手机的小扬声器发不出 300Hz 以下的声音，
 *   只有低频的话，在手机上撞击声几乎听不见。
 * - 一堆球同时落地时好几个撞击声会叠在一起，所以同一时间窗里后来的撞击逐个减弱，
 *   总线上再过一道软限幅，保证不破音。
 */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recent = 0;
  private windowStart = 0;

  /** 浏览器要求在用户手势里创建 / 恢复音频上下文 */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        this.ctx = ctx;
        // 总线：音量 → 软限幅 → 输出。
        // 限幅用一条 tanh 曲线：没有状态、没有延迟，小信号近似线性放大（约 1.5 倍），
        // 多个声音叠到接近满幅时平滑地压住，输出永远不会超过 ±0.89，不会破音。
        // （试过浏览器自带的压缩器：它会把短促的撞击声压掉 5dB、把持续的提示音抬高 6dB，适得其反。）
        this.master = ctx.createGain();
        this.master.gain.value = 0.9;
        const ceiling = ctx.createWaveShaper();
        const curve = new Float32Array(2049);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = 0.98 * Math.tanh(1.5 * x);
        }
        ceiling.curve = curve;
        this.master.connect(ceiling).connect(ctx.destination);
        const len = ctx.sampleRate;
        this.noise = ctx.createBuffer(1, len, len);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      // 除了 suspended，iOS 在切后台、锁屏、来电之后还会报 interrupted，同样需要 resume
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    else if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  private get ready(): boolean {
    return this.enabled && !!this.ctx && this.ctx.state === 'running';
  }

  private tone(
    type: OscillatorType,
    freq: number,
    start: number,
    duration: number,
    volume: number,
    endFreq = freq,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private burst(
    filter: BiquadFilterType,
    freq: number,
    q: number,
    start: number,
    duration: number,
    volume: number,
    endFreq = freq,
    attack = 0.003,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) biquad.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(biquad).connect(gain).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
  }

  /** 撞击声：音量跟接近速度走，篮球比排球更沉 */
  impact(hit: Impact): void {
    if (!this.ready || hit.speed < 0.4) return;
    // 一堆球同时落地时限流：同一时间窗里后来的撞击逐个减弱，超过上限的不再发声
    const now = this.ctx!.currentTime;
    if (now - this.windowStart > HIT_WINDOW) {
      this.windowStart = now;
      this.recent = 0;
    }
    if (this.recent >= MAX_HITS_PER_WINDOW) return;
    const v = Math.min(1, Math.pow(hit.speed / 5.5, 1.15)) / (1 + 0.7 * this.recent);
    this.recent++;
    const heavy = (kind: BallKind | undefined): boolean => kind === 'basketball';
    const jitter = 1 + (Math.random() - 0.5) * 0.12;
    if (hit.type === 'dot') {
      // 磕到筐沿：金属的"叮"
      this.tone('sine', 1180 * jitter, 0, 0.26, 0.24 * v + 0.03);
      this.tone('sine', 1795 * jitter, 0, 0.18, 0.14 * v + 0.02);
      this.burst('highpass', 3000, 0.7, 0, 0.03, 0.12 * v);
    } else if (hit.type === 'rail') {
      // 落在木轨上：球体的闷响 + 木头的"笃" + 球皮拍上去的一下
      const big = heavy(hit.kindA);
      const base = (big ? 128 : 176) * jitter;
      const knock = (big ? 410 : 540) * jitter;
      this.tone('sine', base * 1.6, 0, 0.11, 0.3 * v + 0.02, base);
      this.tone('triangle', knock, 0, 0.07, 0.28 * v + 0.01, knock * 0.85);
      this.burst('bandpass', big ? 1500 : 2100, 1.4, 0, 0.035, 0.34 * v);
    } else {
      // 球碰球：更软更闷的"噗"
      const big = heavy(hit.kindA) || heavy(hit.kindB);
      const base = (big ? 104 : 146) * jitter;
      const pock = (big ? 330 : 440) * jitter;
      this.tone('sine', base * 1.4, 0, 0.09, 0.24 * v + 0.02, base);
      this.tone('sine', pock, 0, 0.06, 0.26 * v + 0.01, pock * 0.8);
      this.burst('bandpass', 1100, 0.9, 0, 0.04, 0.24 * v);
    }
  }

  /** 空心入网的"唰" */
  swish(): void {
    if (!this.ready) return;
    this.burst('bandpass', 3200, 0.9, 0, 0.34, 0.5, 900, 0.05);
    this.burst('highpass', 5200, 0.6, 0.02, 0.2, 0.16, 5200, 0.04);
  }

  win(): void {
    if (!this.ready) return;
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => {
      this.tone('triangle', f, 0.18 + i * 0.085, 0.42, 0.2);
    });
  }

  /** 排球先进：裁判哨 */
  whistle(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    for (const start of [0, 0.3]) {
      const t = ctx.currentTime + start;
      const osc = ctx.createOscillator();
      const trem = ctx.createOscillator();
      const tremGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2480, t);
      trem.frequency.value = 34;
      tremGain.gain.value = 90;
      trem.connect(tremGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.setValueAtTime(0.12, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      trem.start(t);
      osc.stop(t + 0.27);
      trem.stop(t + 0.27);
      this.burst('bandpass', 2500, 3, start, 0.24, 0.04);
    }
  }

  /** 篮球掉出界：一声下滑的叹气 */
  miss(): void {
    if (!this.ready) return;
    this.tone('triangle', 420, 0, 0.5, 0.24, 150);
  }

  /** 排球被倒掉 */
  drop(): void {
    if (!this.ready) return;
    this.tone('sine', 560, 0, 0.13, 0.11, 330);
  }

  click(): void {
    if (!this.ready) return;
    this.burst('bandpass', 2400, 2, 0, 0.05, 0.3);
    this.tone('sine', 880, 0, 0.04, 0.06);
  }
}
