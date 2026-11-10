interface Particle {
  kind: 'confetti' | 'dust';
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  rot: number;
  spin: number;
}

const CONFETTI = ['#f26a2e', '#f1bf2b', '#f6f2e6', '#2b5fb6', '#e0b06a'];

/** 纯装饰的粒子：进球的彩纸、重击时的粉尘。不影响物理。 */
export class Fx {
  private particles: Particle[] = [];

  confetti(x: number, y: number): void {
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = 1.2 + Math.random() * 3.2;
      this.particles.push({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 1.6 + Math.random() * 1.2,
        size: 0.022 + Math.random() * 0.022,
        color: CONFETTI[i % CONFETTI.length],
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 16,
      });
    }
  }

  dust(x: number, y: number, strength: number): void {
    const n = Math.min(7, 2 + Math.floor(strength * 1.5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 0.15 + Math.random() * 0.35 * strength;
      this.particles.push({
        kind: 'dust',
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 0.15,
        age: 0,
        life: 0.28 + Math.random() * 0.2,
        size: 0.012 + Math.random() * 0.014,
        color: 'rgba(246, 238, 214, 1)',
        rot: 0,
        spin: 0,
      });
    }
  }

  /** 球掉出画面底边：从底边往上溅起一小团，告诉玩家"这个球没了" */
  splash(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 1.1 + Math.random() * 1.6;
      this.particles.push({
        kind: 'dust',
        x: x + (Math.random() - 0.5) * 0.08,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.4 + Math.random() * 0.25,
        size: 0.022 + Math.random() * 0.024,
        color: 'rgba(246, 238, 214, 1)',
        rot: 0,
        spin: 0,
      });
    }
  }

  clear(): void {
    this.particles.length = 0;
  }

  step(dt: number): void {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      if (p.kind === 'confetti') {
        p.vy += 5.5 * dt;
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 1.6 * dt;
        p.rot += p.spin * dt;
      } else {
        p.vx *= 1 - 5 * dt;
        p.vy *= 1 - 5 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** 在世界坐标系下绘制（调用方已设好变换） */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const t = p.age / p.life;
      if (p.kind === 'confetti') {
        ctx.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // 用宽度的周期变化模拟彩纸翻转
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size * Math.abs(Math.cos(p.rot * 1.7)) + 0.004, p.size * 0.6);
        ctx.restore();
      } else {
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + t), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
