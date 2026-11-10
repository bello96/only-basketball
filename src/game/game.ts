import { type Ball, type BallKind, type Impact, TICK, World } from '../physics/world';
import type { Level } from './level';

export type GameStatus = 'ready' | 'playing' | 'won' | 'lost';
export type LoseReason = 'volleyball-scored' | 'basketball-lost';

export type GameEvent =
  | { type: 'impact'; impact: Impact }
  | { type: 'score'; kind: BallKind; ball: number }
  | { type: 'out'; kind: BallKind; ball: number }
  | { type: 'win' }
  | { type: 'lose'; reason: LoseReason };

export interface GameOptions {
  /** 开局前先静默模拟一会儿，让球堆自然落稳 */
  settle?: boolean;
  recordImpacts?: boolean;
}

/** 开局静默模拟的时长（秒） */
const SETTLE_SECONDS = 2.5;
/** 球网对球的减速（1/s） */
const NET_DRAG = 2.6;
/** 球心越过筐沿连线多少倍半径才算进球 */
const SCORE_DEPTH = 0.9;
/** 默认的出界线比取景框底边低多少 */
const OUT_MARGIN = 0.12;
const OUT_SIDE = 8;

/** 游戏规则层：在物理世界之上判定进球、出界与胜负。不依赖任何浏览器接口。 */
export class Game {
  readonly level: Level;
  world: World;
  status: GameStatus = 'ready';
  loseReason: LoseReason | null = null;
  /** 从第一次操作算起的用时（秒） */
  time = 0;
  events: GameEvent[] = [];
  outCount: Record<BallKind, number> = { basketball: 0, volleyball: 0 };
  /** 已经穿过篮筐的球（按先后顺序） */
  scored: number[] = [];
  /** 出界线：球整个掉到这条线（世界坐标 y）以下就算出界。屏幕比取景框高时由外部往下放 */
  floorY: number;

  /** 每个球相对筐沿连线的深度（上一 tick），以及是否正处于"入筐途中" */
  private depth: number[] = [];
  private entering: boolean[] = [];
  /** 球是否正兜在网里（只有从筐口进去的球才算） */
  private netted: boolean[] = [];

  constructor(level: Level, opts: GameOptions = {}) {
    this.level = level;
    this.floorY = level.view.bottom + OUT_MARGIN;
    const world = new World({ maxTilt: level.maxTilt });
    this.world = world;
    for (const t of level.tracks) world.addArc({ r: t.r, a0: t.a0, a1: t.a1, gear: t.gear });
    const h = level.hoop;
    for (const side of [-1, 1]) {
      world.addDot({
        r: h.rimR,
        a: h.at + side * h.rimOffset,
        rad: h.rimRad,
        gear: h.gear,
        friction: 0.4,
        bounce: 0.85,
        tag: 'rim',
      });
    }
    for (const spawn of level.balls) world.addBall(spawn);

    if (opts.settle) {
      world.recordImpacts = false;
      const n = Math.round(SETTLE_SECONDS / TICK);
      for (let i = 0; i < n; i++) world.step(TICK);
      for (const b of world.balls) {
        b.px = b.x;
        b.py = b.y;
        b.pa = b.a;
      }
    }
    world.recordImpacts = opts.recordImpacts ?? true;
    world.impacts.length = 0;
    for (const b of world.balls) {
      this.depth.push(this.hoopCoords(b).depth);
      this.entering.push(false);
      this.netted.push(false);
    }
  }

  get basketball(): Ball | undefined {
    return this.world.balls.find((b) => b.kind === 'basketball');
  }

  get over(): boolean {
    return this.status === 'won' || this.status === 'lost';
  }

  /** 篮筐当前朝向（弧度，世界坐标：0 为正下方） */
  hoopAngle(): number {
    return this.level.hoop.at + this.level.hoop.gear * this.world.rigAngle;
  }

  /**
   * 球在篮筐坐标系里的位置：depth 为越过筐沿连线的深度（向筐外 / 网的方向为正），
   * side 为沿筐沿连线方向偏离筐心的距离。
   */
  hoopCoords(b: { x: number; y: number }): { depth: number; side: number } {
    const a = this.hoopAngle();
    const s = Math.sin(a);
    const c = Math.cos(a);
    return {
      depth: b.x * s + b.y * c - this.level.hoop.chordDist,
      side: b.x * c - b.y * s,
    };
  }

  /** 设置转盘目标角（弧度）。第一次真正转动时开始计时。 */
  setTarget(angle: number): void {
    if (this.over) return;
    const before = this.world.rigTarget;
    this.world.setRigTarget(angle);
    if (this.status === 'ready' && Math.abs(this.world.rigTarget - before) > 1e-6) {
      this.status = 'playing';
    }
  }

  tick(): void {
    const world = this.world;
    const events = this.events;
    events.length = 0;
    world.step(TICK);
    for (const impact of world.impacts) events.push({ type: 'impact', impact });

    const hoop = this.level.hoop;
    const bottom = this.floorY;
    const netDamp = 1 / (1 + NET_DRAG * TICK);

    for (const b of world.balls) {
      if (!b.alive) continue;

      // 进球判定：球心从筐沿连线的上方穿到下方，且落点在两个筐沿之间
      const { depth, side } = this.hoopCoords(b);
      const prev = this.depth[b.id];
      this.depth[b.id] = depth;
      const inside = Math.abs(side) < hoop.halfWidth;
      if (!this.entering[b.id]) {
        if (prev < 0 && depth >= 0 && inside && !this.scored.includes(b.id)) {
          this.entering[b.id] = true;
          this.netted[b.id] = true;
        }
      } else if (depth < -0.03 || !inside) {
        // 又弹出去了
        this.entering[b.id] = false;
      } else if (depth >= b.r * SCORE_DEPTH) {
        this.entering[b.id] = false;
        this.scored.push(b.id);
        events.push({ type: 'score', kind: b.kind, ball: b.id });
        if (!this.over) {
          if (b.kind === 'basketball') {
            this.status = 'won';
            events.push({ type: 'win' });
          } else {
            this.lose('volleyball-scored');
          }
        }
      }

      // 从筐口进去的球会被网兜住减速，直到从网底漏出去（或者又弹回筐口上方）
      if (this.netted[b.id]) {
        if (depth < -0.03 || depth > hoop.netLen + b.r || Math.abs(side) > hoop.halfWidth + b.r) {
          this.netted[b.id] = false;
        } else {
          b.vx *= netDamp;
          b.vy *= netDamp;
          b.w *= netDamp;
        }
      }

      // 出界
      if (b.y - b.r > bottom || Math.abs(b.x) > OUT_SIDE || b.y < -OUT_SIDE) {
        b.alive = false;
        this.outCount[b.kind]++;
        events.push({ type: 'out', kind: b.kind, ball: b.id });
        if (b.kind === 'basketball' && !this.over && !this.scored.includes(b.id)) {
          this.lose('basketball-lost');
        }
      }
    }

    if (this.status === 'playing') this.time += TICK;
  }

  /** 按用时评星：1~3 */
  stars(): number {
    const [three, two] = this.level.par;
    return this.time <= three ? 3 : this.time <= two ? 2 : 1;
  }

  clone(): Game {
    const g = Object.create(Game.prototype) as Game;
    Object.assign(g, this);
    g.world = this.world.clone();
    g.events = [];
    g.outCount = { ...this.outCount };
    g.scored = [...this.scored];
    g.depth = [...this.depth];
    g.entering = [...this.entering];
    g.netted = [...this.netted];
    return g;
  }

  private lose(reason: LoseReason): void {
    this.status = 'lost';
    this.loseReason = reason;
    this.events.push({ type: 'lose', reason });
  }
}
