import { describe, expect, it } from 'vitest';
import { Game, type GameEvent } from '../src/game/game';
import {
  HOOP_GAP_CLEAR,
  HOOP_WIDTH,
  type LevelSpec,
  RIM_DROP,
  RIM_RAD,
  compileLevel,
  rowOnRing,
} from '../src/game/level';
import { BALL_SPECS, type BallKind, RAIL_HALF, TICK, deg } from '../src/physics/world';

type Spawn = { kind: BallKind; x: number; y: number };

/** 一圈半径 1 米的轨道，篮筐挂在 hoopAt 度处 */
function oneRing(balls: Spawn[], hoopAt = 0): LevelSpec {
  return {
    name: '测试',
    hint: '',
    maxTilt: 70,
    rings: [{ r: 1.0, span: [-60, 60] }],
    hoop: { ring: 0, at: hoopAt },
    balls,
    par: [10, 20],
  };
}

function play(game: Game, seconds: number, each?: (events: GameEvent[]) => void): GameEvent[] {
  const all: GameEvent[] = [];
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) {
    game.tick();
    all.push(...game.events);
    each?.(game.events);
  }
  return all;
}

const REST = 1.0 - RAIL_HALF;

describe('关卡编译', () => {
  it('缺口把一圈轨道切成两段，两端各让出圆头半径', () => {
    const level = compileLevel({ ...oneRing([], 40), rings: [{ r: 1.0, span: [-60, 60], gaps: [[-20, 0.3]] }] }, 0);
    const half = (0.3 / 2 + RAIL_HALF) / 1.0;
    const hoopHalf = (HOOP_GAP_CLEAR / 2 + RAIL_HALF) / 1.0;
    expect(level.tracks).toHaveLength(3);
    expect(level.tracks[0].a0).toBeCloseTo(deg(-60), 9);
    expect(level.tracks[0].a1).toBeCloseTo(deg(-20) - half, 9);
    expect(level.tracks[1].a0).toBeCloseTo(deg(-20) + half, 9);
    expect(level.tracks[1].a1).toBeCloseTo(deg(40) - hoopHalf, 9);
    expect(level.tracks[2].a0).toBeCloseTo(deg(40) + hoopHalf, 9);
    expect(level.tracks[2].a1).toBeCloseTo(deg(60), 9);
  });

  it('篮筐的两个筐沿位于缺口正下方，内径等于 HOOP_WIDTH', () => {
    const level = compileLevel(oneRing([], 25), 3);
    const h = level.hoop;
    expect(level.index).toBe(3);
    expect(h.at).toBeCloseTo(deg(25), 9);
    expect(h.rimR * Math.cos(h.rimOffset)).toBeCloseTo(1.0 + RIM_DROP, 9);
    expect(h.rimR * Math.sin(h.rimOffset)).toBeCloseTo(HOOP_WIDTH / 2 + RIM_RAD, 9);
    expect(h.halfWidth).toBeCloseTo(HOOP_WIDTH / 2, 9);
  });

  it('贴着轨道尽头的缺口不会切出空轨道', () => {
    const level = compileLevel(
      { ...oneRing([], 40), rings: [{ r: 1.0, span: [-60, 60], gaps: [[-60, 0.3]] }] },
      0,
    );
    for (const t of level.tracks) expect(t.a1).toBeGreaterThan(t.a0);
    expect(level.tracks[0].a0).toBeGreaterThan(deg(-60));
  });

  it('rowOnRing 摆出的一行球都贴着轨道且互不重叠', () => {
    const row = rowOnRing(0.62, 0, ['volleyball', 'basketball', 'volleyball']);
    expect(row.map((b) => b.kind)).toEqual(['volleyball', 'basketball', 'volleyball']);
    row.forEach((b) => {
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(0.62 - RAIL_HALF - BALL_SPECS[b.kind].r, 9);
    });
    for (let i = 1; i < row.length; i++) {
      const gap =
        Math.hypot(row[i].x - row[i - 1].x, row[i].y - row[i - 1].y) -
        BALL_SPECS[row[i].kind].r -
        BALL_SPECS[row[i - 1].kind].r;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.02);
    }
    expect(row[0].x).toBeLessThan(row[1].x);
    expect(Math.abs(row[1].x)).toBeLessThan(1e-9);
  });
});

describe('胜负判定', () => {
  it('篮球第一个穿过篮筐：胜利', () => {
    const game = new Game(compileLevel(oneRing([{ kind: 'basketball', x: 0, y: 0.5 }]), 0));
    const events = play(game, 1.5);
    expect(game.status).toBe('won');
    expect(game.scored).toEqual([0]);
    expect(events.filter((e) => e.type === 'score')).toEqual([{ type: 'score', kind: 'basketball', ball: 0 }]);
    expect(events.filter((e) => e.type === 'win')).toHaveLength(1);
  });

  it('排球先穿过篮筐：失败，之后篮球再进也不算', () => {
    const game = new Game(
      compileLevel(
        oneRing([
          { kind: 'volleyball', x: 0, y: 0.6 },
          { kind: 'basketball', x: 0, y: 0.1 },
        ]),
        0,
      ),
    );
    const events = play(game, 2);
    expect(game.status).toBe('lost');
    expect(game.loseReason).toBe('volleyball-scored');
    expect(game.scored).toEqual([0, 1]);
    expect(events.filter((e) => e.type === 'lose')).toEqual([{ type: 'lose', reason: 'volleyball-scored' }]);
    expect(events.some((e) => e.type === 'win')).toBe(false);
  });

  it('篮球掉出界：失败', () => {
    const game = new Game(compileLevel(oneRing([{ kind: 'basketball', x: 1.6, y: 0 }], 40), 0));
    const events = play(game, 2);
    expect(game.status).toBe('lost');
    expect(game.loseReason).toBe('basketball-lost');
    expect(game.outCount.basketball).toBe(1);
    expect(game.world.balls[0].alive).toBe(false);
    expect(events.filter((e) => e.type === 'out')).toEqual([{ type: 'out', kind: 'basketball', ball: 0 }]);
  });

  it('排球掉出界只计数，不影响胜负', () => {
    const game = new Game(
      compileLevel(
        oneRing(
          [
            { kind: 'volleyball', x: 1.6, y: 0 },
            { kind: 'basketball', x: 0, y: REST - 0.12 },
          ],
          40,
        ),
        0,
      ),
    );
    play(game, 2);
    expect(game.status).toBe('ready');
    expect(game.outCount).toEqual({ basketball: 0, volleyball: 1 });
    expect(game.world.balls[0].alive).toBe(false);
    expect(game.world.balls[1].alive).toBe(true);
  });

  it('出界线可以往下放（屏幕比取景框高时），球要掉过这条线才算出界', () => {
    const level = compileLevel(oneRing([{ kind: 'volleyball', x: 1.6, y: 0 }], 40), 0);
    const game = new Game(level);
    expect(game.floorY).toBeCloseTo(level.view.bottom + 0.12, 9);
    game.floorY = level.view.bottom + 3;
    const ball = game.world.balls[0];
    let outAt = NaN;
    play(game, 3, (events) => {
      if (events.some((e) => e.type === 'out') && Number.isNaN(outAt)) outAt = ball.y;
    });
    expect(ball.alive).toBe(false);
    expect(outAt - ball.r).toBeGreaterThan(level.view.bottom + 3);
    expect(outAt - ball.r).toBeLessThan(level.view.bottom + 3.2);
  });

  it('球网只兜住从筐口进去的球：从歪着的篮筐外侧落下的球不会被凭空减速', () => {
    // 篮筐挂在 40° 处。球从右侧筐沿的外面竖直落下，不碰轨道也不碰筐沿，
    // 但途中会穿过"筐口正下方沿筐轴方向"的那条带
    const level = compileLevel({ ...oneRing([{ kind: 'volleyball', x: 1.02, y: 0.2 }], 40), rings: [{ r: 1.0, span: [-60, 54] }] }, 0);
    const game = new Game(level);
    game.world.linDamp = 0;
    const ball = game.world.balls[0];
    let crossedBand = false;
    const n = Math.round(0.5 / TICK);
    for (let i = 0; i < n; i++) {
      game.tick();
      const { depth, side } = game.hoopCoords(ball);
      if (depth > 0.3 && depth < 0.5 && Math.abs(side) < 0.1) crossedBand = true;
    }
    expect(crossedBand).toBe(true);
    expect(game.scored).toEqual([]);
    // 全程自由落体：没有碰到任何东西，速度就是 g·t
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBeCloseTo(9.8 * n * TICK, 6);
  });

  it('从筐口进去的球会被球网兜住减速', () => {
    const game = new Game(compileLevel(oneRing([{ kind: 'basketball', x: 0, y: 0.5 }]), 0));
    game.world.linDamp = 0;
    const ball = game.world.balls[0];
    const n = Math.round(0.45 / TICK);
    for (let i = 0; i < n; i++) game.tick();
    expect(game.status).toBe('won');
    expect(ball.vy).toBeGreaterThan(1);
    expect(ball.vy).toBeLessThan(9.8 * n * TICK * 0.9);
  });

  it('从下往上穿过篮筐不算进球，落回来穿过才算', () => {
    const game = new Game(compileLevel(oneRing([{ kind: 'basketball', x: 0, y: 1.6 }]), 0));
    const ball = game.world.balls[0];
    ball.vy = -6.5;
    let goneUp = false;
    let scoredOnWayUp = false;
    play(game, 0.6, () => {
      if (ball.y < 0.8) goneUp = true;
      if (ball.vy < 0 && game.status === 'won') scoredOnWayUp = true;
    });
    expect(goneUp).toBe(true);
    expect(scoredOnWayUp).toBe(false);
    play(game, 1.5);
    expect(game.status).toBe('won');
  });

  it('已经胜利之后排球再进筐，结果不变', () => {
    const game = new Game(
      compileLevel(
        oneRing([
          { kind: 'basketball', x: 0, y: 0.6 },
          { kind: 'volleyball', x: 0, y: 0.1 },
        ]),
        0,
      ),
    );
    play(game, 2);
    expect(game.status).toBe('won');
    expect(game.loseReason).toBeNull();
    expect(game.scored).toEqual([0, 1]);
  });
});

describe('操作与计时', () => {
  const resting = (): Game =>
    new Game(compileLevel(oneRing([{ kind: 'basketball', x: 0, y: REST - 0.12 }], 40), 0));

  it('第一次转动之前不计时，转动后开始计时', () => {
    const game = resting();
    play(game, 0.5);
    expect(game.status).toBe('ready');
    expect(game.time).toBe(0);
    game.setTarget(deg(5));
    expect(game.status).toBe('playing');
    play(game, 0.5);
    expect(game.time).toBeCloseTo(0.5, 6);
    expect(game.world.rigAngle).toBeGreaterThan(deg(4));
  });

  it('把篮筐转到球下方后进球，计时停止，之后的操作不再生效', () => {
    const game = resting();
    // 篮筐在 +40°，把它转到正下方需要转盘转到 -40°
    game.setTarget(deg(-40));
    play(game, 3);
    expect(game.status).toBe('won');
    const t = game.time;
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThan(3);
    const target = game.world.rigTarget;
    game.setTarget(deg(30));
    play(game, 0.5);
    expect(game.time).toBe(t);
    expect(game.world.rigTarget).toBe(target);
  });

  it('目标角被限制在最大倾角以内', () => {
    const game = resting();
    game.setTarget(deg(500));
    expect(game.world.rigTarget).toBeCloseTo(deg(70), 9);
  });

  it('按用时评星', () => {
    const game = resting();
    game.time = 8;
    expect(game.stars()).toBe(3);
    game.time = 15;
    expect(game.stars()).toBe(2);
    game.time = 30;
    expect(game.stars()).toBe(1);
  });

  it('settle：开局时球已经落稳，计时和事件都是干净的', () => {
    const level = compileLevel(
      oneRing(
        [
          { kind: 'basketball', x: 0.0, y: 0.3 },
          { kind: 'volleyball', x: 0.25, y: 0.3 },
          { kind: 'volleyball', x: -0.25, y: 0.3 },
        ],
        40,
      ),
      0,
    );
    const game = new Game(level, { settle: true });
    expect(game.status).toBe('ready');
    expect(game.time).toBe(0);
    expect(game.events).toHaveLength(0);
    expect(game.world.balls).toHaveLength(3);
    for (const b of game.world.balls) {
      expect(Math.hypot(b.vx, b.vy)).toBeLessThan(0.02);
      expect(Math.abs(Math.hypot(b.x, b.y) - (REST - b.r))).toBeLessThan(2e-3);
      expect(b.px).toBe(b.x);
    }
  });

  it('clone 出来的对局与原对局演化完全一致', () => {
    const level = compileLevel(
      oneRing(
        [
          { kind: 'basketball', x: 0.0, y: 0.3 },
          { kind: 'volleyball', x: 0.25, y: 0.3 },
        ],
        40,
      ),
      0,
    );
    const a = new Game(level, { settle: true });
    a.setTarget(deg(-20));
    play(a, 0.4);
    const b = a.clone();
    for (const g of [a, b]) {
      g.setTarget(deg(-45));
      play(g, 2.5);
    }
    expect(b.status).toBe(a.status);
    expect(b.time).toBe(a.time);
    expect(b.scored).toEqual(a.scored);
    expect(b.world.balls[1].x).toBe(a.world.balls[1].x);
    expect(b.world).not.toBe(a.world);
  });
});
