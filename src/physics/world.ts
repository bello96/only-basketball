/**
 * 专用 2D 刚体物理引擎：圆球 × 圆弧轨道 / 圆点 的精确解析碰撞。
 *
 * 坐标约定：x 向右，y 向下（与屏幕一致），重力默认 (0, +g)。
 * 转盘（rig）绕原点转动。角度约定：从正下方起算，向 +x 方向为正，
 * 即半径 R、角度 a 的点位于 (R·sin a, R·cos a)。rigAngle 为正时，转盘底部向右移动。
 * 球自身的朝向角 / 角速度沿用屏幕惯例：顺时针为正。
 *
 * 求解器：小步长 + 软约束的顺序冲量法（思路同 Box2D v3 的 soft step）。
 * 每个子步都重新做一次解析碰撞检测，所以球在圆弧上滚动没有折线拼接的颠簸。
 */

export const TICK = 1 / 120;
/** 轨道半厚度（米） */
export const RAIL_HALF = 0.025;

export const deg = (d: number): number => (d * Math.PI) / 180;

const TWO_PI = Math.PI * 2;
/** 预判接触的余量：间距小于它就建立接触约束 */
const MARGIN = 0.02;
/** 接近速度低于它就不再反弹 */
const RESTITUTION_THRESHOLD = 0.5;
/** 穿透修正的最大推出速度 */
const MAX_PUSH = 3;
const CONTACT_HERTZ = 30;
const CONTACT_DAMPING = 10;
/** 低于这个接近速度的碰撞不产生撞击事件 */
const IMPACT_MIN_SPEED = 0.25;
const MAX_BALLS = 64;
const KEY_STRIDE = 4096;

export type BallKind = 'basketball' | 'volleyball';

export interface BallSpec {
  /** 半径（米） */
  r: number;
  /** 质量（千克） */
  mass: number;
  /** 转动惯量系数 k = I / (m r²)，空心球为 2/3 */
  k: number;
  /** 对硬表面的恢复系数 */
  restitution: number;
  /** 摩擦系数 */
  friction: number;
  /** 滚动阻力系数 */
  rolling: number;
}

export const BALL_SPECS: Record<BallKind, BallSpec> = {
  basketball: { r: 0.12, mass: 0.62, k: 2 / 3, restitution: 0.55, friction: 0.7, rolling: 0.05 },
  volleyball: { r: 0.105, mass: 0.27, k: 2 / 3, restitution: 0.5, friction: 0.5, rolling: 0.055 },
};

export interface BallDef {
  kind: BallKind;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  w?: number;
}

export interface ArcDef {
  /** 中心线半径 */
  r: number;
  /** 起止角（弧度，转盘坐标系），a0 < a1 */
  a0: number;
  a1: number;
  /** 半厚度，默认 RAIL_HALF */
  half?: number;
  /** 传动比：1 随转盘同向，-1 反向，0 固定不动 */
  gear?: number;
  friction?: number;
  /** 反弹系数倍率（乘在球自身的恢复系数上） */
  bounce?: number;
}

export interface DotDef {
  /** 极坐标（转盘坐标系） */
  r: number;
  a: number;
  /** 圆点自身半径 */
  rad: number;
  gear?: number;
  friction?: number;
  bounce?: number;
  tag?: string;
}

export interface WorldOptions {
  gravity?: number;
  substeps?: number;
  velIters?: number;
  linDamp?: number;
  angDamp?: number;
  maxTilt?: number;
}

export interface Impact {
  type: 'ball' | 'rail' | 'dot';
  /** 碰撞前的法向接近速度（m/s，正值） */
  speed: number;
  x: number;
  y: number;
  /** 球的 id */
  a: number;
  /** 另一方：球的 id 或碰撞体下标 */
  b: number;
  kindA: BallKind;
  kindB?: BallKind;
  tag?: string;
}

export class Ball {
  id = 0;
  kind: BallKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 朝向角（弧度，屏幕顺时针为正） */
  a = 0;
  /** 角速度 */
  w: number;
  /** 上一 tick 的状态（渲染插值用） */
  px: number;
  py: number;
  pa = 0;
  r: number;
  m: number;
  invM: number;
  invI: number;
  e: number;
  mu: number;
  roll: number;
  alive = true;

  constructor(def: BallDef, spec: BallSpec) {
    this.kind = def.kind;
    this.x = this.px = def.x;
    this.y = this.py = def.y;
    this.vx = def.vx ?? 0;
    this.vy = def.vy ?? 0;
    this.w = def.w ?? 0;
    this.r = spec.r;
    this.m = spec.mass;
    this.invM = 1 / spec.mass;
    this.invI = 1 / (spec.k * spec.mass * spec.r * spec.r);
    this.e = spec.restitution;
    this.mu = spec.friction;
    this.roll = spec.rolling;
  }
}

export interface Arc {
  r: number;
  a0: number;
  a1: number;
  half: number;
  gear: number;
  friction: number;
  bounce: number;
}

export interface Dot {
  r: number;
  a: number;
  rad: number;
  gear: number;
  friction: number;
  bounce: number;
  tag?: string;
}

interface Softness {
  biasRate: number;
  massScale: number;
  impulseScale: number;
}

function makeSoftness(hertz: number, zeta: number, h: number): Softness {
  const omega = TWO_PI * hertz;
  const a1 = 2 * zeta + h * omega;
  const a2 = h * omega * a1;
  const a3 = 1 / (1 + a2);
  return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
}

/** 一对物体之间的接触约束。跨子步保留累计冲量用于热启动。 */
class Contact {
  stamp = 0;
  /** A 为球时非空；A 为轨道 / 圆点时为空，其表面速度记在 svx/svy */
  a: Ball | null = null;
  b!: Ball;
  /** 法线，从 A 指向 B */
  nx = 0;
  ny = 0;
  sep = 0;
  ra = 0;
  rb = 0;
  svx = 0;
  svy = 0;
  /** 碰撞体的角速度（顺时针为正） */
  sw = 0;
  mu = 0;
  e = 0;
  roll = 0;
  kn = 0;
  kt = 0;
  kr = 0;
  jn = 0;
  jt = 0;
  jr = 0;
  vn0 = 0;
  maxJn = 0;
  soft!: Softness;
  touching = false;
  type: Impact['type'] = 'rail';
  other = 0;
  tag: string | undefined = undefined;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class World {
  balls: Ball[] = [];
  arcs: Arc[] = [];
  dots: Dot[] = [];

  gx = 0;
  gy: number;
  substeps: number;
  velIters: number;
  linDamp: number;
  angDamp: number;

  /** 转盘当前角度 / 角速度 */
  rigAngle = 0;
  rigOmega = 0;
  /** 'spring'：追随 rigTarget；'manual'：由外部直接设置 rigOmega */
  rigDrive: 'spring' | 'manual' = 'spring';
  rigTarget = 0;
  maxTilt: number;
  maxOmega = 6;
  maxAlpha = 200;
  /** 追随增益（1/s）：越大跟手越紧 */
  rigGain = 22;

  /** 球与球之间的摩擦系数。球面之间比球与轨道之间滑得多，否则挨着的球会互相卡住没法滚 */
  ballFriction = 0.12;

  /** 是否记录撞击事件（批量模拟时可关掉） */
  recordImpacts = true;
  /** 最近一次 step 内发生的撞击（供音效使用） */
  impacts: Impact[] = [];

  private stepCount = 0;
  private cache = new Map<number, Contact>();
  private active: Contact[] = [];
  private pool: Contact[] = [];

  constructor(opts: WorldOptions = {}) {
    this.gy = opts.gravity ?? 9.8;
    this.substeps = opts.substeps ?? 4;
    this.velIters = opts.velIters ?? 2;
    this.linDamp = opts.linDamp ?? 0.02;
    this.angDamp = opts.angDamp ?? 0.05;
    this.maxTilt = opts.maxTilt ?? deg(70);
  }

  addBall(def: BallDef, overrides: Partial<BallSpec> = {}): Ball {
    if (this.balls.length >= MAX_BALLS) throw new Error('球太多了');
    const ball = new Ball(def, { ...BALL_SPECS[def.kind], ...overrides });
    ball.id = this.balls.length;
    this.balls.push(ball);
    return ball;
  }

  addArc(def: ArcDef): Arc {
    const arc: Arc = {
      r: def.r,
      a0: def.a0,
      a1: def.a1,
      half: def.half ?? RAIL_HALF,
      gear: def.gear ?? 1,
      friction: def.friction ?? 0.8,
      bounce: def.bounce ?? 1,
    };
    this.arcs.push(arc);
    return arc;
  }

  addDot(def: DotDef): Dot {
    const dot: Dot = {
      r: def.r,
      a: def.a,
      rad: def.rad,
      gear: def.gear ?? 1,
      friction: def.friction ?? 0.5,
      bounce: def.bounce ?? 1,
      tag: def.tag,
    };
    this.dots.push(dot);
    return dot;
  }

  setRigTarget(angle: number): void {
    this.rigTarget = clamp(angle, -this.maxTilt, this.maxTilt);
  }

  /** 圆点当前的世界坐标 */
  dotPosition(dot: Dot): { x: number; y: number } {
    const a = dot.a + dot.gear * this.rigAngle;
    return { x: dot.r * Math.sin(a), y: dot.r * Math.cos(a) };
  }

  /** 推进一个 tick（内部再细分为 substeps 个子步） */
  step(dt: number): void {
    this.impacts.length = 0;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
    }
    const h = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) this.substep(h);
  }

  clone(): World {
    const c = new World();
    c.gx = this.gx;
    c.gy = this.gy;
    c.substeps = this.substeps;
    c.velIters = this.velIters;
    c.linDamp = this.linDamp;
    c.angDamp = this.angDamp;
    c.rigAngle = this.rigAngle;
    c.rigOmega = this.rigOmega;
    c.rigDrive = this.rigDrive;
    c.rigTarget = this.rigTarget;
    c.maxTilt = this.maxTilt;
    c.maxOmega = this.maxOmega;
    c.maxAlpha = this.maxAlpha;
    c.rigGain = this.rigGain;
    c.ballFriction = this.ballFriction;
    c.recordImpacts = this.recordImpacts;
    c.stepCount = this.stepCount;
    // 轨道和圆点创建后不再改动，可以共享
    c.arcs = this.arcs;
    c.dots = this.dots;
    c.balls = this.balls.map((b) => Object.assign(Object.create(Ball.prototype) as Ball, b));
    for (const [key, ct] of this.cache) {
      const copy = new Contact();
      copy.stamp = ct.stamp;
      copy.jn = ct.jn;
      copy.jt = ct.jt;
      copy.jr = ct.jr;
      copy.touching = ct.touching;
      c.cache.set(key, copy);
    }
    return c;
  }

  // ---------------------------------------------------------------- 内部

  private substep(h: number): void {
    this.stepCount++;

    // 1. 转盘角速度
    if (this.rigDrive === 'spring') {
      const err = this.rigTarget - this.rigAngle;
      const mag = Math.abs(err);
      // 远处按最大角速度追，近处指数收敛；√ 项保证以 maxAlpha 的减速度刹得住，不会冲过头
      let want = Math.min(this.rigGain * mag, Math.sqrt(this.maxAlpha * mag), this.maxOmega);
      if (err < 0) want = -want;
      const dvMax = this.maxAlpha * h;
      this.rigOmega += clamp(want - this.rigOmega, -dvMax, dvMax);
    }

    // 2. 球：重力与空气阻尼
    const ld = 1 / (1 + h * this.linDamp);
    const ad = 1 / (1 + h * this.angDamp);
    for (const b of this.balls) {
      if (!b.alive) continue;
      b.vx = (b.vx + this.gx * h) * ld;
      b.vy = (b.vy + this.gy * h) * ld;
      b.w *= ad;
    }

    // 3. 碰撞检测
    const hertz = Math.min(CONTACT_HERTZ, 0.25 / h);
    const softBall = makeSoftness(hertz, CONTACT_DAMPING, h);
    const softStatic = makeSoftness(2 * hertz, CONTACT_DAMPING, h);
    this.detect(softBall, softStatic);
    const active = this.active;
    const n = active.length;

    // 4. 记录碰撞前的法向速度，并热启动
    for (let i = 0; i < n; i++) {
      const c = active[i];
      const a = c.a;
      const b = c.b;
      const invMA = a ? a.invM : 0;
      const invIA = a ? a.invI : 0;
      c.kn = 1 / (invMA + b.invM);
      c.kt = 1 / (invMA + b.invM + invIA * c.ra * c.ra + b.invI * c.rb * c.rb);
      c.kr = 1 / (invIA + b.invI);
      c.vn0 = a
        ? (b.vx - a.vx) * c.nx + (b.vy - a.vy) * c.ny
        : (b.vx - c.svx) * c.nx + (b.vy - c.svy) * c.ny;
      c.maxJn = c.jn;
      if (c.jn !== 0 || c.jt !== 0 || c.jr !== 0) {
        const px = c.jn * c.nx - c.jt * c.ny;
        const py = c.jn * c.ny + c.jt * c.nx;
        b.vx += b.invM * px;
        b.vy += b.invM * py;
        b.w += b.invI * (c.jr - c.rb * c.jt);
        if (a) {
          a.vx -= a.invM * px;
          a.vy -= a.invM * py;
          a.w -= a.invI * (c.jr + c.ra * c.jt);
        }
      }
    }

    // 5. 速度约束（带穿透修正偏置）
    const invH = 1 / h;
    for (let it = 0; it < this.velIters; it++) {
      for (let i = 0; i < n; i++) this.solveContact(active[i], invH, true);
    }

    // 6. 位置积分
    for (const b of this.balls) {
      if (!b.alive) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
    }
    this.rigAngle += this.rigOmega * h;
    if (this.rigDrive === 'spring') {
      if (this.rigAngle > this.maxTilt) {
        this.rigAngle = this.maxTilt;
        if (this.rigOmega > 0) this.rigOmega = 0;
      } else if (this.rigAngle < -this.maxTilt) {
        this.rigAngle = -this.maxTilt;
        if (this.rigOmega < 0) this.rigOmega = 0;
      }
    }
    // 位置变了，按线性近似更新间距
    for (let i = 0; i < n; i++) {
      const c = active[i];
      const a = c.a;
      const b = c.b;
      const vn = a
        ? (b.vx - a.vx) * c.nx + (b.vy - a.vy) * c.ny
        : (b.vx - c.svx) * c.nx + (b.vy - c.svy) * c.ny;
      c.sep += vn * h;
    }

    // 7. 松弛：去掉偏置再解一遍，把修正穿透时注入的多余速度拿掉
    for (let i = 0; i < n; i++) this.solveContact(active[i], invH, false);

    // 8. 反弹，并记录撞击事件
    for (let i = 0; i < n; i++) {
      const c = active[i];
      const a = c.a;
      const b = c.b;
      const touching = c.maxJn > 0;
      if (touching && !c.touching && this.recordImpacts && c.vn0 < -IMPACT_MIN_SPEED) {
        this.impacts.push({
          type: c.type,
          speed: -c.vn0,
          x: b.x - c.nx * b.r,
          y: b.y - c.ny * b.r,
          a: b.id,
          b: c.other,
          kindA: b.kind,
          kindB: a ? a.kind : undefined,
          tag: c.tag,
        });
      }
      c.touching = touching;
      if (c.e === 0 || c.vn0 > -RESTITUTION_THRESHOLD || c.maxJn === 0) continue;
      const vn = a
        ? (b.vx - a.vx) * c.nx + (b.vy - a.vy) * c.ny
        : (b.vx - c.svx) * c.nx + (b.vy - c.svy) * c.ny;
      let dj = -c.kn * (vn + c.e * c.vn0);
      const total = Math.max(c.jn + dj, 0);
      dj = total - c.jn;
      b.vx += b.invM * dj * c.nx;
      b.vy += b.invM * dj * c.ny;
      if (a) {
        a.vx -= a.invM * dj * c.nx;
        a.vy -= a.invM * dj * c.ny;
      }
      // 弹开之后这对接触即将分离，不把这次的冲量带进下一步的热启动
      c.jn = 0;
      c.jt = 0;
      c.jr = 0;
      c.touching = false;
    }

    // 9. 清掉已经分开的接触
    for (const [key, c] of this.cache) {
      if (c.stamp !== this.stepCount) {
        this.cache.delete(key);
        c.a = null;
        this.pool.push(c);
      }
    }
  }

  private solveContact(c: Contact, invH: number, useBias: boolean): void {
    const a = c.a;
    const b = c.b;
    const nx = c.nx;
    const ny = c.ny;
    const invMA = a ? a.invM : 0;

    // 法向：不可穿透
    {
      const vn = a ? (b.vx - a.vx) * nx + (b.vy - a.vy) * ny : (b.vx - c.svx) * nx + (b.vy - c.svy) * ny;
      let bias = 0;
      let massScale = 1;
      let impulseScale = 0;
      if (c.sep > 0) {
        // 还没碰上：只允许在本子步内正好贴上
        bias = c.sep * invH;
      } else if (useBias) {
        bias = Math.max(c.soft.biasRate * c.sep, -MAX_PUSH);
        massScale = c.soft.massScale;
        impulseScale = c.soft.impulseScale;
      }
      let dj = -c.kn * massScale * (vn + bias) - impulseScale * c.jn;
      const total = Math.max(c.jn + dj, 0);
      dj = total - c.jn;
      c.jn = total;
      if (total > c.maxJn) c.maxJn = total;
      b.vx += b.invM * dj * nx;
      b.vy += b.invM * dj * ny;
      if (a) {
        a.vx -= invMA * dj * nx;
        a.vy -= invMA * dj * ny;
      }
    }

    // 切向：库仑摩擦（带动自旋）
    {
      const tx = -ny;
      const ty = nx;
      const vt = a
        ? (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - b.w * c.rb - a.w * c.ra
        : (b.vx - c.svx) * tx + (b.vy - c.svy) * ty - b.w * c.rb;
      const maxF = c.mu * c.jn;
      const total = clamp(c.jt - c.kt * vt, -maxF, maxF);
      const dj = total - c.jt;
      c.jt = total;
      b.vx += b.invM * dj * tx;
      b.vy += b.invM * dj * ty;
      b.w -= b.invI * c.rb * dj;
      if (a) {
        a.vx -= invMA * dj * tx;
        a.vy -= invMA * dj * ty;
        a.w -= a.invI * c.ra * dj;
      }
    }

    // 滚动阻力：抵抗两个表面之间的相对滚动
    if (c.roll > 0) {
      const wrel = b.w - (a ? a.w : c.sw);
      const maxR = c.roll * c.jn;
      const total = clamp(c.jr - c.kr * wrel, -maxR, maxR);
      const dj = total - c.jr;
      c.jr = total;
      b.w += b.invI * dj;
      if (a) a.w -= a.invI * dj;
    }
  }

  private touch(key: number): Contact {
    let c = this.cache.get(key);
    if (!c) {
      c = this.pool.pop() ?? new Contact();
      c.jn = 0;
      c.jt = 0;
      c.jr = 0;
      c.touching = false;
      this.cache.set(key, c);
    }
    c.stamp = this.stepCount;
    this.active.push(c);
    return c;
  }

  private detect(softBall: Softness, softStatic: Softness): void {
    this.active.length = 0;
    const balls = this.balls;
    const arcs = this.arcs;
    const dots = this.dots;
    const phi = this.rigAngle;
    const omega = this.rigOmega;
    const nArcs = arcs.length;

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.alive) continue;

      // 球 × 球
      for (let j = 0; j < i; j++) {
        const a = balls[j];
        if (!a.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.r + b.r + MARGIN;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        const c = this.touch(i * KEY_STRIDE + j);
        c.a = a;
        c.b = b;
        if (d > 1e-9) {
          c.nx = dx / d;
          c.ny = dy / d;
        } else {
          c.nx = 0;
          c.ny = -1;
        }
        c.sep = d - a.r - b.r;
        c.ra = a.r;
        c.rb = b.r;
        c.mu = this.ballFriction;
        c.e = Math.sqrt(a.e * b.e);
        c.roll = 0.5 * Math.min(a.roll * a.r, b.roll * b.r);
        c.soft = softBall;
        c.type = 'ball';
        c.other = a.id;
        c.tag = undefined;
      }

      const dist = Math.hypot(b.x, b.y);

      // 球 × 弧轨
      for (let k = 0; k < nArcs; k++) {
        const arc = arcs[k];
        const reach = arc.half + b.r + MARGIN;
        if (Math.abs(dist - arc.r) >= reach) continue;
        const turn = arc.gear * phi;
        const halfSpan = (arc.a1 - arc.a0) / 2;
        let nx = 0;
        let ny = -1;
        let sep = 0;
        // 整圈轨道没有端点，永远是径向接触
        let radial = halfSpan >= Math.PI;
        if (!radial) {
          let delta = Math.atan2(b.x, b.y) - ((arc.a0 + arc.a1) / 2 + turn);
          delta -= TWO_PI * Math.round(delta / TWO_PI);
          radial = Math.abs(delta) <= halfSpan;
          if (!radial) {
            // 弧的端点是圆头：取最近的那个端点
            const ea = (delta > 0 ? arc.a1 : arc.a0) + turn;
            const ex = b.x - arc.r * Math.sin(ea);
            const ey = b.y - arc.r * Math.cos(ea);
            const ed = Math.hypot(ex, ey);
            if (ed >= reach) continue;
            sep = ed - arc.half - b.r;
            if (ed > 1e-9) {
              nx = ex / ed;
              ny = ey / ed;
            }
          }
        }
        if (radial) {
          if (dist <= 1e-9) continue;
          if (dist >= arc.r) {
            nx = b.x / dist;
            ny = b.y / dist;
            sep = dist - arc.r - arc.half - b.r;
          } else {
            nx = -b.x / dist;
            ny = -b.y / dist;
            sep = arc.r - dist - arc.half - b.r;
          }
        }
        const c = this.touch(i * KEY_STRIDE + MAX_BALLS + k);
        c.a = null;
        c.b = b;
        c.nx = nx;
        c.ny = ny;
        c.sep = sep;
        c.ra = 0;
        c.rb = b.r;
        // 接触点处轨道表面的速度：绕原点的刚体转动
        const rate = arc.gear * omega;
        const qx = b.x - nx * b.r;
        const qy = b.y - ny * b.r;
        c.svx = rate * qy;
        c.svy = -rate * qx;
        c.sw = -rate;
        c.mu = Math.sqrt(b.mu * arc.friction);
        c.e = b.e * arc.bounce;
        c.roll = b.roll * b.r;
        c.soft = softStatic;
        c.type = 'rail';
        c.other = k;
        c.tag = undefined;
      }

      // 球 × 圆点
      for (let k = 0; k < dots.length; k++) {
        const dot = dots[k];
        const reach = dot.rad + b.r + MARGIN;
        if (Math.abs(dist - dot.r) >= reach) continue;
        const da = dot.a + dot.gear * phi;
        const ex = b.x - dot.r * Math.sin(da);
        const ey = b.y - dot.r * Math.cos(da);
        const d2 = ex * ex + ey * ey;
        if (d2 >= reach * reach) continue;
        const ed = Math.sqrt(d2);
        const c = this.touch(i * KEY_STRIDE + MAX_BALLS + nArcs + k);
        c.a = null;
        c.b = b;
        if (ed > 1e-9) {
          c.nx = ex / ed;
          c.ny = ey / ed;
        } else {
          c.nx = 0;
          c.ny = -1;
        }
        c.sep = ed - dot.rad - b.r;
        c.ra = 0;
        c.rb = b.r;
        const rate = dot.gear * omega;
        const qx = b.x - c.nx * b.r;
        const qy = b.y - c.ny * b.r;
        c.svx = rate * qy;
        c.svy = -rate * qx;
        c.sw = -rate;
        c.mu = Math.sqrt(b.mu * dot.friction);
        c.e = b.e * dot.bounce;
        c.roll = 0;
        c.soft = softStatic;
        c.type = 'dot';
        c.other = k;
        c.tag = dot.tag;
      }
    }
  }
}
