import type { BallKind, Impact } from './physics/world';

/** 全部音效都用 WebAudio 现场合成，不加载任何音频文件。 */
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
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
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
    // 一堆球同时落地时限流，免得糊成一片
    const now = this.ctx!.currentTime;
    if (now - this.windowStart > 0.08) {
      this.windowStart = now;
      this.recent = 0;
    }
    if (++this.recent > 5) return;
    const v = Math.min(1, Math.pow(hit.speed / 5.5, 1.15));
    const heavy = (kind: BallKind | undefined): boolean => kind === 'basketball';
    const jitter = 1 + (Math.random() - 0.5) * 0.12;
    if (hit.type === 'dot') {
      // 磕到筐沿：金属的"叮"
      this.tone('sine', 1180 * jitter, 0, 0.26, 0.2 * v + 0.03);
      this.tone('sine', 1795 * jitter, 0, 0.18, 0.12 * v + 0.02);
      this.burst('highpass', 3000, 0.7, 0, 0.03, 0.12 * v);
    } else if (hit.type === 'rail') {
      // 落在木轨上：短促的"笃"加球体的闷响
      const base = heavy(hit.kindA) ? 128 : 176;
      this.tone('sine', base * jitter * 1.6, 0, 0.11, 0.5 * v + 0.02, base * jitter);
      this.burst('bandpass', heavy(hit.kindA) ? 1500 : 2100, 1.4, 0, 0.035, 0.32 * v);
    } else {
      // 球碰球：更软更闷
      const base = heavy(hit.kindA) || heavy(hit.kindB) ? 104 : 146;
      this.tone('sine', base * jitter * 1.4, 0, 0.09, 0.36 * v + 0.02, base * jitter);
      this.burst('lowpass', 900, 0.8, 0, 0.04, 0.2 * v);
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
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      gain.gain.setValueAtTime(0.16, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      trem.start(t);
      osc.stop(t + 0.27);
      trem.stop(t + 0.27);
      this.burst('bandpass', 2500, 3, start, 0.24, 0.05);
    }
  }

  /** 篮球掉出界：一声下滑的叹气 */
  miss(): void {
    if (!this.ready) return;
    this.tone('triangle', 330, 0, 0.5, 0.22, 110);
  }

  /** 排球被倒掉 */
  drop(): void {
    if (!this.ready) return;
    this.tone('sine', 520, 0, 0.12, 0.07, 300);
  }

  click(): void {
    if (!this.ready) return;
    this.burst('bandpass', 2400, 2, 0, 0.03, 0.14);
  }
}
