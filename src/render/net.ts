import type { Game } from '../game/game';
import type { Hoop } from '../game/level';
import { TICK } from '../physics/world';

/** 网的行数（第 0 行钉在筐沿上） */
const ROWS = 7;
/** 网底相对筐口的收窄比例 */
const TAPER = 0.56;
const GRAVITY = 9.8;
const DAMPING = 0.975;
const ITERATIONS = 6;
const BALL_PAD = 0.01;

/**
 * 球网：纯视觉的绳网模拟（Verlet）。
 * 侧视图里网是个上宽下窄的筒，这里只模拟左右两条轮廓绳，
 * 中间的网眼在绘制时按圆筒投影插值出来。球穿过时会把网撑开、带着网晃动。
 */
export class Net {
  /** 节点坐标：[左0..左6, 右0..右6] */
  readonly x = new Float64Array(ROWS * 2);
  readonly y = new Float64Array(ROWS * 2);
  private px = new Float64Array(ROWS * 2);
  private py = new Float64Array(ROWS * 2);
  private restWidth = new Float64Array(ROWS);
  private segLen = new Float64Array(ROWS);
  readonly rows = ROWS;

  constructor(private hoop: Hoop) {
    const rowGap = hoop.netLen / (ROWS - 1);
    for (let i = 0; i < ROWS; i++) {
      const t = i / (ROWS - 1);
      this.restWidth[i] = hoop.halfWidth * 2 * (1 - (1 - TAPER) * Math.pow(t, 0.75));
    }
    for (let i = 1; i < ROWS; i++) {
      const dw = (this.restWidth[i - 1] - this.restWidth[i]) / 2;
      this.segLen[i] = Math.hypot(dw, rowGap);
    }
  }

  /** 筐沿两端当前的位置（左、右）与筐的朝向 */
  private anchors(game: Game): { lx: number; ly: number; rx: number; ry: number; ex: number; ey: number } {
    const a = game.hoopAngle();
    const s = Math.sin(a);
    const c = Math.cos(a);
    const d = this.hoop.chordDist;
    const hw = this.hoop.halfWidth;
    return { lx: d * s - hw * c, ly: d * c + hw * s, rx: d * s + hw * c, ry: d * c - hw * s, ex: s, ey: c };
  }

  /** 把网摆回自然下垂的静止形状 */
  reset(game: Game): void {
    const { lx, ly, rx, ry } = this.anchors(game);
    const rowGap = this.hoop.netLen / (ROWS - 1);
    const mx = (lx + rx) / 2;
    const my = (ly + ry) / 2;
    const tx = (rx - lx) / (this.hoop.halfWidth * 2);
    const ty = (ry - ly) / (this.hoop.halfWidth * 2);
    for (let i = 0; i < ROWS; i++) {
      const hw = this.restWidth[i] / 2;
      // 静止时直接竖直下垂
      this.x[i] = mx - tx * hw;
      this.y[i] = my - ty * hw + rowGap * i;
      this.x[ROWS + i] = mx + tx * hw;
      this.y[ROWS + i] = my + ty * hw + rowGap * i;
    }
    this.px.set(this.x);
    this.py.set(this.y);
    for (let k = 0; k < 90; k++) this.step(game);
  }

  step(game: Game): void {
    const { x, y, px, py } = this;
    const n = ROWS * 2;
    const g = GRAVITY * TICK * TICK;
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === ROWS) continue;
      const vx = (x[i] - px[i]) * DAMPING;
      const vy = (y[i] - py[i]) * DAMPING;
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx;
      y[i] += vy + g;
    }
    const { lx, ly, rx, ry } = this.anchors(game);
    const balls = game.world.balls;
    for (let it = 0; it < ITERATIONS; it++) {
      x[0] = lx;
      y[0] = ly;
      x[ROWS] = rx;
      y[ROWS] = ry;
      // 绳段不可拉长（可以松弛）
      for (let side = 0; side < 2; side++) {
        const o = side * ROWS;
        for (let i = 1; i < ROWS; i++) {
          const ax = x[o + i - 1];
          const ay = y[o + i - 1];
          const dx = x[o + i] - ax;
          const dy = y[o + i] - ay;
          const d = Math.hypot(dx, dy);
          if (d > this.segLen[i] && d > 1e-9) {
            const k = this.segLen[i] / d;
            if (i === 1) {
              x[o + i] = ax + dx * k;
              y[o + i] = ay + dy * k;
            } else {
              const cx = (dx * (1 - k)) / 2;
              const cy = (dy * (1 - k)) / 2;
              x[o + i - 1] += cx;
              y[o + i - 1] += cy;
              x[o + i] -= cx;
              y[o + i] -= cy;
            }
          }
        }
      }
      // 每一圈网绳有个自然宽度：软约束，把左右两侧拉回这个宽度
      for (let i = 1; i < ROWS; i++) {
        const dx = x[ROWS + i] - x[i];
        const dy = y[ROWS + i] - y[i];
        const d = Math.hypot(dx, dy);
        if (d < 1e-9) continue;
        const k = ((d - this.restWidth[i]) / d) * 0.22;
        x[i] += dx * k;
        y[i] += dy * k;
        x[ROWS + i] -= dx * k;
        y[ROWS + i] -= dy * k;
      }
      // 球把网撑开
      for (const b of balls) {
        if (!b.alive) continue;
        const reach = b.r + BALL_PAD;
        for (let i = 1; i < n; i++) {
          if (i === ROWS) continue;
          const dx = x[i] - b.x;
          const dy = y[i] - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          x[i] = b.x + (dx / d) * reach;
          y[i] = b.y + (dy / d) * reach;
        }
      }
    }
  }
}
