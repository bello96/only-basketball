import { describe, expect, it } from 'vitest';
import { BALL_SPECS, Ball, RAIL_HALF, TICK, World, deg } from '../src/physics/world';

const G = 9.8;
const BB = BALL_SPECS.basketball;
const VB = BALL_SPECS.volleyball;

function run(world: World, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) {
    world.step(TICK);
    each?.((i + 1) * TICK);
  }
}

const speed = (b: Ball): number => Math.hypot(b.vx, b.vy);
const radius = (b: Ball): number => Math.hypot(b.x, b.y);
/** 球相对圆心的角度（从正下方起算，向右为正） */
const angleOf = (b: Ball): number => Math.atan2(b.x, b.y);

describe('自由运动', () => {
  it('自由落体符合 s = ½gt²', () => {
    const w = new World({ linDamp: 0, angDamp: 0 });
    const b = w.addBall({ kind: 'basketball', x: 0, y: 0 });
    run(w, 0.5);
    expect(b.vy).toBeCloseTo(G * 0.5, 3);
    expect(Math.abs(b.y - 0.5 * G * 0.25)).toBeLessThan(0.01);
    expect(b.x).toBe(0);
  });

  it('无重力时两球对心碰撞动量守恒，分离速度符合恢复系数', () => {
    const w = new World({ gravity: 0, linDamp: 0, angDamp: 0 });
    const a = w.addBall({ kind: 'basketball', x: -0.5, y: 0, vx: 2 });
    const b = w.addBall({ kind: 'volleyball', x: 0.5, y: 0, vx: -1 });
    const p0 = a.m * a.vx + b.m * b.vx;
    run(w, 0.6);
    const p1 = a.m * a.vx + b.m * b.vx;
    expect(p1).toBeCloseTo(p0, 9);
    const e = Math.sqrt(BB.restitution * VB.restitution);
    const separating = b.vx - a.vx;
    expect(separating).toBeGreaterThan(0);
    expect(Math.abs(separating - e * 3) / (e * 3)).toBeLessThan(0.02);
    expect(Math.abs(a.vy) + Math.abs(b.vy)).toBeLessThan(1e-9);
  });
});

describe('球与弧轨', () => {
  it('落入碗底后静止，几乎不陷入轨道', () => {
    const w = new World();
    w.addArc({ r: 0.6, a0: deg(-60), a1: deg(60) });
    const rest = 0.6 - RAIL_HALF - BB.r;
    const b = w.addBall({ kind: 'basketball', x: 0.02, y: rest - 0.05 });
    run(w, 4);
    expect(speed(b)).toBeLessThan(1e-3);
    expect(Math.abs(b.w)).toBeLessThan(1e-2);
    expect(Math.abs(b.x)).toBeLessThan(0.03);
    expect(Math.abs(radius(b) - rest)).toBeLessThan(5e-4);
  });

  it('反弹高度符合恢复系数 e²·H', () => {
    const w = new World({ linDamp: 0, angDamp: 0 });
    w.addArc({ r: 1.0, a0: deg(-60), a1: deg(60) });
    const rest = 1.0 - RAIL_HALF - BB.r;
    const H = 0.4;
    const b = w.addBall({ kind: 'basketball', x: 0, y: rest - H });
    let bounced = false;
    let apex = Infinity;
    let prevVy = 0;
    let done = false;
    run(w, 1.5, () => {
      if (done) return;
      if (!bounced && prevVy > 0 && b.vy < 0) bounced = true;
      else if (bounced && prevVy < 0 && b.vy >= 0) done = true;
      if (bounced) apex = Math.min(apex, b.y);
      prevVy = b.vy;
    });
    expect(bounced).toBe(true);
    const rebound = rest - apex;
    const expected = BB.restitution ** 2 * H;
    expect(Math.abs(rebound - expected) / expected).toBeLessThan(0.12);
  });

  it('在碗里纯滚动的摆动周期 T = 2π√((1+k)L/g)', () => {
    const w = new World({ linDamp: 0, angDamp: 0 });
    w.addArc({ r: 1.0, a0: deg(-80), a1: deg(80) });
    const L = 1.0 - RAIL_HALF - BB.r;
    const th = deg(6);
    const b = w.addBall({ kind: 'basketball', x: L * Math.sin(th), y: L * Math.cos(th) }, { rolling: 0 });
    const crossings: number[] = [];
    let prevX = b.x;
    run(w, 8, (t) => {
      if (prevX < 0 && b.x >= 0) crossings.push(t);
      prevX = b.x;
    });
    expect(crossings.length).toBeGreaterThanOrEqual(3);
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    const expected = 2 * Math.PI * Math.sqrt(((1 + BB.k) * L) / G);
    expect(Math.abs(period - expected) / expected).toBeLessThan(0.015);
  });

  it('静止转盘上机械能不会凭空增加，最终停下', () => {
    const w = new World();
    w.addArc({ r: 0.8, a0: deg(-85), a1: deg(85) });
    const L = 0.8 - RAIL_HALF - VB.r;
    const th = deg(50);
    const b = w.addBall({ kind: 'volleyball', x: L * Math.sin(th), y: L * Math.cos(th) });
    const energy = (): number =>
      0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + (0.5 * b.w * b.w) / b.invI - b.m * G * b.y;
    const e0 = energy();
    let maxE = -Infinity;
    run(w, 25, () => {
      maxE = Math.max(maxE, energy());
    });
    expect(maxE).toBeLessThan(e0 + 2e-3);
    expect(speed(b)).toBeLessThan(1e-3);
    expect(Math.abs(angleOf(b))).toBeLessThan(deg(4));
  });

  it('高速球不会穿透轨道', () => {
    const w = new World();
    // 整圈封闭轨道：球没有任何合法的出路，只要跑到外面就是穿透
    w.addArc({ r: 0.8, a0: -Math.PI, a1: Math.PI });
    const down = w.addBall({ kind: 'volleyball', x: 0.05, y: 0, vy: 14 });
    const side = w.addBall({ kind: 'basketball', x: -0.2, y: 0.3, vx: 13, vy: 2 });
    let moved = 0;
    let worst = -Infinity;
    run(w, 3, () => {
      moved = Math.max(moved, radius(down));
      for (const b of [down, side]) worst = Math.max(worst, radius(b) + b.r - (0.8 - RAIL_HALF));
    });
    expect(moved).toBeGreaterThan(0.5);
    // 陷入轨道表面的最大深度始终远小于球半径
    expect(worst).toBeLessThan(0.04);
  });

  it('一堆球落进碗里会稳定堆叠，互不穿透', () => {
    const w = new World();
    w.addArc({ r: 0.6, a0: deg(-70), a1: deg(70) });
    const spots: [number, number][] = [
      [-0.23, 0.2],
      [0.0, 0.25],
      [0.23, 0.2],
      [-0.12, -0.05],
      [0.12, -0.05],
      [0.0, -0.3],
    ];
    spots.forEach(([x, y], i) => w.addBall({ kind: i === 1 ? 'basketball' : 'volleyball', x, y }));
    run(w, 6);
    // 球确实落下来了：最上面的球下沉，底层的球贴着轨道内表面
    expect(w.balls[5].y).toBeGreaterThan(-0.2);
    expect(Math.max(...w.balls.map((b) => radius(b) + b.r))).toBeGreaterThan(0.6 - RAIL_HALF - 2e-3);
    for (const b of w.balls) {
      expect(speed(b)).toBeLessThan(0.02);
      expect(radius(b) + b.r).toBeLessThan(0.6 - RAIL_HALF + 1.5e-3);
    }
    for (let i = 0; i < w.balls.length; i++) {
      for (let j = i + 1; j < w.balls.length; j++) {
        const a = w.balls[i];
        const b = w.balls[j];
        const overlap = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
        expect(overlap).toBeLessThan(1.5e-3);
      }
    }
  });
});

describe('转盘运动', () => {
  it('弹簧驱动：平滑追到目标角且不超过最大倾角', () => {
    const w = new World({ maxTilt: deg(70) });
    w.setRigTarget(deg(40));
    let maxOmega = 0;
    run(w, 0.6, () => {
      maxOmega = Math.max(maxOmega, Math.abs(w.rigOmega));
    });
    expect(Math.abs(w.rigAngle - deg(40))).toBeLessThan(deg(0.5));
    expect(maxOmega).toBeLessThanOrEqual(w.maxOmega + 1e-9);
    w.setRigTarget(deg(200));
    let maxAngle = 0;
    run(w, 1.5, () => {
      maxAngle = Math.max(maxAngle, w.rigAngle);
    });
    expect(maxAngle).toBeLessThanOrEqual(deg(70) + 1e-9);
    expect(Math.abs(w.rigAngle - deg(70))).toBeLessThan(deg(0.5));
  });

  it('缺口慢慢转到球的正下方，球从缺口掉下去', () => {
    const w = new World();
    w.rigDrive = 'manual';
    w.addArc({ r: 1.0, a0: deg(-70), a1: deg(30) });
    w.addArc({ r: 1.0, a0: deg(50), a1: deg(70) });
    const rest = 1.0 - RAIL_HALF - BB.r;
    const b = w.addBall({ kind: 'basketball', x: 0, y: rest });
    w.rigOmega = -0.3;
    run(w, 1.0);
    // 缺口还没到：球仍在轨道上，在底部附近小幅摆动
    expect(Math.abs(radius(b) - rest)).toBeLessThan(2e-3);
    expect(Math.abs(angleOf(b))).toBeLessThan(deg(8));
    run(w, deg(40) / 0.3 - 1.0);
    w.rigOmega = 0;
    run(w, 1.0);
    expect(b.y).toBeGreaterThan(1.3);
  });

  it('轨道尽头转到底部，球从尽头滚落', () => {
    const w = new World();
    w.rigDrive = 'manual';
    w.addArc({ r: 0.6, a0: deg(-30), a1: deg(30) });
    const b = w.addBall({ kind: 'volleyball', x: 0, y: 0.6 - RAIL_HALF - VB.r });
    w.rigOmega = -0.35;
    run(w, deg(42) / 0.35);
    w.rigOmega = 0;
    run(w, 1.0);
    expect(b.y).toBeGreaterThan(1.0);
    expect(b.x).toBeGreaterThan(0);
  });

  it('惯性：轨道加速时纯滚动的空心球只获得 k/(1+k)=40% 的加速度', () => {
    const w = new World({ linDamp: 0, angDamp: 0 });
    w.rigDrive = 'manual';
    const R = 200;
    w.addArc({ r: R, a0: deg(-2), a1: deg(2) });
    const b = w.addBall({ kind: 'basketball', x: 0, y: R - RAIL_HALF - BB.r }, { rolling: 0 });
    const surfaceAccel = 2;
    const alpha = surfaceAccel / (R - RAIL_HALF);
    // 每个 tick 取区间中点的角速度，相当于匀角加速
    w.rigOmega = alpha * (TICK / 2);
    run(w, 1.0, (t) => {
      w.rigOmega = alpha * (t + TICK / 2);
    });
    const expected = (BB.k / (1 + BB.k)) * 0.5 * surfaceAccel * 1.0;
    expect(Math.abs(b.x - expected) / expected).toBeLessThan(0.03);
  });

  it('匀速转动的轨道上，球留在底部附近纯滚动：接触点不打滑，平衡点被滚动阻力略微带偏', () => {
    const w = new World();
    w.rigDrive = 'manual';
    w.addArc({ r: 1.0, a0: -Math.PI, a1: Math.PI });
    const b = w.addBall({ kind: 'basketball', x: 0, y: 1.0 - RAIL_HALF - BB.r });
    w.rigOmega = 0.5;
    /** 接触点处球面相对轨道表面的切向滑动速度 */
    const slip = (): number => {
      const d = radius(b);
      const nx = -b.x / d;
      const ny = -b.y / d;
      const qx = b.x - nx * b.r;
      const qy = b.y - ny * b.r;
      const svx = w.rigOmega * qy;
      const svy = -w.rigOmega * qx;
      return (b.vx - svx) * -ny + (b.vy - svy) * nx - b.w * b.r;
    };
    let maxSlip = 0;
    let maxAngle = 0;
    let sum = 0;
    let count = 0;
    run(w, 14, (t) => {
      if (t < 2) return;
      maxSlip = Math.max(maxSlip, Math.abs(slip()));
      maxAngle = Math.max(maxAngle, Math.abs(angleOf(b)));
      sum += angleOf(b);
      count++;
    });
    expect(maxSlip).toBeLessThan(0.01);
    expect(maxAngle).toBeLessThan(deg(10));
    // 轨道向 +x 方向转，球的平均位置被带向 +x 一点点（tanθ ≈ 滚动阻力系数）
    const mean = sum / count;
    expect(mean).toBeGreaterThan(deg(0.5));
    expect(mean).toBeLessThan(deg(4));
    // 球在原地打转：自旋方向与轨道表面运动一致
    expect(b.w).toBeLessThan(0);
  });

  it('急转之后球因惯性滞后于轨道', () => {
    const w = new World({ maxTilt: deg(70) });
    w.addArc({ r: 1.0, a0: deg(-80), a1: deg(80) });
    const b = w.addBall({ kind: 'volleyball', x: 0, y: 1.0 - RAIL_HALF - VB.r });
    w.setRigTarget(deg(30));
    run(w, 0.25);
    expect(w.rigAngle).toBeGreaterThan(deg(25));
    expect(angleOf(b)).toBeGreaterThan(deg(1));
    expect(angleOf(b)).toBeLessThan(w.rigAngle * 0.6);
  });
});

describe('圆点碰撞体与世界复制', () => {
  it('球碰到固定圆点会被弹开而不穿过', () => {
    const w = new World();
    w.addDot({ r: 1.0, a: 0, rad: 0.02, gear: 0 });
    const b = w.addBall({ kind: 'basketball', x: 0.03, y: 0.4 });
    let minGap = Infinity;
    run(w, 1.2, () => {
      minGap = Math.min(minGap, Math.hypot(b.x, b.y - 1.0) - b.r - 0.02);
    });
    expect(minGap).toBeGreaterThan(-3e-3);
    expect(minGap).toBeLessThan(0.02);
    expect(b.x).toBeGreaterThan(0.1);
  });

  it('clone 之后两份世界的演化完全一致', () => {
    const w = new World();
    w.addArc({ r: 0.6, a0: deg(-60), a1: deg(60) });
    w.addArc({ r: 1.0, a0: deg(-70), a1: deg(20) });
    w.addDot({ r: 1.3, a: deg(10), rad: 0.02 });
    w.addBall({ kind: 'basketball', x: 0.0, y: 0.2 });
    w.addBall({ kind: 'volleyball', x: 0.2, y: 0.1 });
    w.addBall({ kind: 'volleyball', x: -0.2, y: 0.1 });
    w.setRigTarget(deg(-45));
    run(w, 0.7);
    const c = w.clone();
    const drive = (world: World): void => {
      let i = 0;
      run(world, 3, () => {
        i++;
        if (i === 60) world.setRigTarget(deg(50));
        if (i === 200) world.setRigTarget(deg(-20));
      });
    };
    drive(w);
    drive(c);
    expect(c.rigAngle).toBe(w.rigAngle);
    for (let i = 0; i < w.balls.length; i++) {
      expect(c.balls[i].x).toBe(w.balls[i].x);
      expect(c.balls[i].y).toBe(w.balls[i].y);
      expect(c.balls[i].w).toBe(w.balls[i].w);
    }
    expect(c.balls[0]).not.toBe(w.balls[0]);
  });
});
