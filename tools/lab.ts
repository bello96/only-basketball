/**
 * 关卡实验台：用脚本操作转盘，打印球的去向。设计关卡、验证解法时用。
 * 用法：node --import ./tools/register.mjs tools/lab.ts <关卡序号> [脚本名]
 */
import { Game } from '../src/game/game';
import type { Level } from '../src/game/level';
import { type Ball, RAIL_HALF, TICK, deg } from '../src/physics/world';

const toDeg = (r: number): number => (r * 180) / Math.PI;

export type Step =
  | { turn: number; rate: number; until?: (g: Game) => boolean; label?: string }
  | { hold: number; until?: (g: Game) => boolean; label?: string };

/** 球现在在哪：第几圈轨道上（-1 表示悬空或叠在别的球上），以及相对正下方的角度 */
export function whereIs(game: Game, b: Ball): { ring: number; angle: number } {
  const dist = Math.hypot(b.x, b.y);
  const angle = toDeg(Math.atan2(b.x, b.y));
  let ring = -1;
  game.level.rings.forEach((spec, i) => {
    if (Math.abs(dist - (spec.r - RAIL_HALF - b.r)) < 0.012) ring = i;
  });
  return { ring, angle };
}

export function describe(game: Game): string {
  return game.world.balls
    .map((b) => {
      const tag = `${b.kind === 'basketball' ? 'B' : 'V'}${b.id}`;
      if (game.scored.includes(b.id)) return `${tag}:进筐`;
      if (!b.alive) return `${tag}:出界`;
      const { ring, angle } = whereIs(game, b);
      return `${tag}:${ring < 0 ? '空' : `#${ring + 1}`}(${angle.toFixed(0)}°)`;
    })
    .join('  ');
}

/** 画出每圈轨道在转盘坐标系里的覆盖情况（每格 2°），H 为篮筐缺口 */
export function barcode(level: Level): string {
  const lines: string[] = [];
  const cols: number[] = [];
  for (let a = -100; a <= 100; a += 2) cols.push(a);
  lines.push(`      ${cols.map((a) => (a % 20 === 0 ? '|' : ' ')).join('')}`);
  level.rings.forEach((ring, i) => {
    const gear = ring.gear ?? 1;
    const row = cols.map((a) => {
      const rad = deg(a);
      const covered = level.tracks.some((t) => t.ring === i && rad >= t.a0 && rad <= t.a1);
      if (covered) return gear < 0 ? '~' : '=';
      const hoopHalf = level.hoop.halfWidth / level.hoop.ringR;
      if (i === level.hoop.ring && Math.abs(rad - level.hoop.at) < hoopHalf) return 'H';
      return ' ';
    });
    lines.push(`#${i + 1} ${ring.r.toFixed(2)} ${row.join('')}`);
  });
  lines.push(`      ${cols.map((a) => (a === 0 ? '0' : a % 20 === 0 ? '|' : ' ')).join('')}   （-100° … +100°）`);
  return lines.join('\n');
}

export interface RunResult {
  status: Game['status'];
  reason: Game['loseReason'];
  time: number;
  log: string[];
}

export function runScript(game: Game, steps: Step[], verbose = true): RunResult {
  const log: string[] = [];
  let target = toDeg(game.world.rigTarget);
  let clock = 0;
  const say = (msg: string): void => {
    const line = `${clock.toFixed(2).padStart(6)}s  φ=${toDeg(game.world.rigAngle).toFixed(1).padStart(6)}°  ${msg}`;
    log.push(line);
    if (verbose) console.log(line);
  };
  const tick = (): void => {
    game.tick();
    clock += TICK;
    for (const e of game.events) {
      if (e.type === 'score') say(`★ ${e.kind === 'basketball' ? '篮球' : '排球'}进筐`);
      else if (e.type === 'out') say(`· ${e.kind === 'basketball' ? '篮球' : '排球'}${e.ball} 出界`);
      else if (e.type === 'win') say('=== 胜利 ===');
      else if (e.type === 'lose') say(`=== 失败：${e.reason} ===`);
    }
  };
  say(`开局  ${describe(game)}`);
  for (const step of steps) {
    if ('turn' in step) {
      const dir = Math.sign(step.turn - target);
      while (!game.over) {
        if (step.until?.(game)) break;
        if (dir === 0 || (step.turn - target) * dir <= 0) break;
        target += dir * step.rate * TICK;
        if ((step.turn - target) * dir < 0) target = step.turn;
        game.setTarget(deg(target));
        tick();
      }
      say(`${step.label ?? `转到 ${step.turn}°`} 完成  ${describe(game)}`);
    } else {
      const n = Math.round(step.hold / TICK);
      for (let i = 0; i < n && !game.over; i++) {
        if (step.until?.(game)) break;
        tick();
      }
      say(`${step.label ?? `停 ${step.hold}s`}  ${describe(game)}`);
    }
    if (game.over) break;
  }
  return { status: game.status, reason: game.loseReason, time: game.time, log };
}

/**
 * 拟人扰动：每一步的转速随机 ±25%，步骤之间随机多停 0~0.6 秒。
 * 同一个种子永远得到同一份脚本，所以结果可以复现。
 */
export function noisyScript(steps: Step[], seed: number): Step[] {
  let state = seed * 2654435761;
  const rand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const noisy: Step[] = [];
  for (const st of steps) {
    noisy.push('turn' in st ? { ...st, rate: st.rate * (0.75 + rand() * 0.5) } : st);
    noisy.push({ hold: rand() * 0.6 });
  }
  return noisy;
}

// ---------------------------------------------------------------- 命令行入口

async function main(): Promise<void> {
  const { LEVELS } = await import('../src/game/levels');
  const index = Number(process.argv[2] ?? 1) - 1;
  const level = LEVELS[index];
  if (!level) throw new Error(`没有第 ${index + 1} 关`);
  console.log(`第 ${index + 1} 关「${level.name}」  最大倾角 ±${toDeg(level.maxTilt).toFixed(0)}°`);
  console.log(barcode(level));
  const { SCRIPTS } = await import('./scripts');
  const name = process.argv[3] ?? 'solve';
  if (name === 'robust') {
    // 参考解法的容错度：把每一步的转速整体放慢 / 加快，看还能不能过
    const steps = SCRIPTS[index]?.solve;
    if (!steps) throw new Error('这一关还没有参考解法');
    for (const factor of [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5]) {
      const scaled = steps.map((st) => ('turn' in st ? { ...st, rate: st.rate * factor } : st));
      const game = new Game(level, { settle: true, recordImpacts: false });
      const result = runScript(game, scaled, false);
      console.log(`转速 ×${factor.toFixed(2)}：${result.status}${result.reason ? `（${result.reason}）` : ''}  ${result.time.toFixed(1)}s`);
    }
    return;
  }
  if (name === 'fuzz') {
    // 拟人扰动跑 20 局看胜率
    const steps = SCRIPTS[index]?.solve;
    if (!steps) throw new Error('这一关还没有参考解法');
    let wins = 0;
    const fails: string[] = [];
    const runs = 20;
    for (let seed = 1; seed <= runs; seed++) {
      const game = new Game(level, { settle: true, recordImpacts: false });
      const result = runScript(game, noisyScript(steps, seed), false);
      if (result.status === 'won') wins++;
      else fails.push(`#${seed}:${result.status}${result.reason ? `(${result.reason})` : ''}`);
    }
    console.log(`拟人扰动 ${runs} 局：胜 ${wins} 局${fails.length ? `；未过：${fails.join(' ')}` : ''}`);
    return;
  }
  if (name === 'sweep') {
    // 不动脑筋的玩法：朝一个方向匀速转到底，停一会儿，再转到另一头。看看这样会不会赢。
    const max = toDeg(level.maxTilt);
    for (const first of [-1, 1]) {
      for (const rate of [8, 14, 22, 35, 60]) {
        const game = new Game(level, { settle: true, recordImpacts: false });
        const result = runScript(
          game,
          [{ turn: first * max, rate }, { hold: 2.5 }, { turn: -first * max, rate }, { hold: 2.5 }],
          false,
        );
        const events = result.log.filter((l) => /进筐|出界|胜利|失败/.test(l)).map((l) => l.replace(/s+/g, ' ').trim());
        console.log(`先向${first < 0 ? '左' : '右'}转 ${String(rate).padStart(2)}°/s：${result.status.padEnd(7)} ${result.reason ?? ''}`);
        for (const e of events) console.log(`      ${e}`);
      }
    }
    return;
  }
  const steps = SCRIPTS[index]?.[name];
  if (!steps) {
    console.log(`（没有名为 ${name} 的脚本，只显示开局）`);
    console.log(describe(new Game(level, { settle: true })));
    return;
  }
  const game = new Game(level, { settle: true, recordImpacts: false });
  const result = runScript(game, steps);
  console.log(`结果：${result.status}${result.reason ? `（${result.reason}）` : ''}  用时 ${result.time.toFixed(2)}s`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/lab.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
