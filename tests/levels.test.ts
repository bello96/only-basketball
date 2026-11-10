import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { LEVELS } from '../src/game/levels';
import { TICK, deg } from '../src/physics/world';
import { noisyScript, runScript, whereIs } from '../tools/lab';
import { SCRIPTS } from '../tools/scripts';

const toDeg = (r: number): number => (r * 180) / Math.PI;

describe('关卡', () => {
  it('一共 7 关，每关恰好一个篮球', () => {
    expect(LEVELS).toHaveLength(7);
    for (const level of LEVELS) {
      expect(level.balls.filter((b) => b.kind === 'basketball')).toHaveLength(1);
    }
  });

  it.each(LEVELS.map((level) => [level.index + 1, level.name, level] as const))(
    '第 %i 关「%s」开局稳定：球都待在轨道上，没有球在动，也没有提前分出胜负',
    (_n, _name, level) => {
      const game = new Game(level, { settle: true });
      for (let i = 0; i < Math.round(1.5 / TICK); i++) game.tick();
      expect(game.status).toBe('ready');
      expect(game.outCount).toEqual({ basketball: 0, volleyball: 0 });
      for (const b of game.world.balls) {
        expect(b.alive).toBe(true);
        expect(Math.hypot(b.vx, b.vy)).toBeLessThan(0.03);
        // 球都在第一圈轨道的半径以内或者贴在某圈轨道上，没有悬在半空往下掉的
        expect(b.y).toBeLessThan(level.view.bottom - 0.4);
      }
      const basketball = game.basketball!;
      expect(whereIs(game, basketball).ring).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(LEVELS.map((level) => [level.index + 1, level.name, level] as const))(
    '第 %i 关「%s」的篮筐转得到正下方',
    (_n, _name, level) => {
      // 篮筐缺口转到正下方所需的转盘角度，必须在最大倾角以内
      const needed = Math.abs(level.hoop.at / level.hoop.gear);
      expect(needed).toBeLessThan(level.maxTilt - deg(2));
    },
  );

  it.each(LEVELS.map((level) => [level.index + 1, level.name, level] as const))(
    '第 %i 关「%s」按参考解法能过，且用时够得上三星',
    (_n, _name, level) => {
      const steps = SCRIPTS[level.index]?.solve;
      expect(steps, '缺少参考解法').toBeDefined();
      const game = new Game(level, { settle: true, recordImpacts: false });
      const result = runScript(game, steps!, false);
      expect(result.status, result.log.slice(-4).join('\n')).toBe('won');
      expect(result.time).toBeLessThan(level.par[0]);
      expect(game.stars()).toBe(3);
    },
  );

  it.each(LEVELS.map((level) => [level.index + 1, level.name, level] as const))(
    '第 %i 关「%s」的解法经得起手抖：转速 ±25%、随机停顿的 20 局里至少赢 17 局',
    (_n, _name, level) => {
      let wins = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const game = new Game(level, { settle: true, recordImpacts: false });
        if (runScript(game, noisyScript(SCRIPTS[level.index].solve, seed), false).status === 'won') wins++;
      }
      expect(wins).toBeGreaterThanOrEqual(17);
    },
  );

  it.each([
    [2, '清场', 1],
    [5, '反着来', 1],
  ] as const)('第 %i 关「%s」：不清掉挡路的排球、直接把篮筐转过去，排球会先进', (n, _name, dir) => {
    const level = LEVELS[n - 1];
    for (const rate of [8, 14, 22, 35]) {
      const game = new Game(level, { settle: true, recordImpacts: false });
      const result = runScript(game, [{ turn: dir * toDeg(level.maxTilt), rate }, { hold: 2 }], false);
      expect(result.status).toBe('lost');
      expect(result.reason).toBe('volleyball-scored');
    }
  });
});
