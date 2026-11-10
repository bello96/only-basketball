/**
 * 各关的操作脚本（实验 / 参考解法）。turn 的数值是转盘目标角 φ（度）：
 * φ 为正时转盘底部向右移动；转盘坐标系里 a 度处的缺口转到正下方需要 φ = -a。
 */
import type { Game } from '../src/game/game';
import type { BallKind } from '../src/physics/world';
import { type Step, whereIs } from './lab';

export const out =
  (kind: BallKind, n: number) =>
  (g: Game): boolean =>
    g.outCount[kind] >= n;

/** 第 id 号球已经离开第 ring 圈（从 1 数起）轨道 */
export const left =
  (id: number, ring: number) =>
  (g: Game): boolean =>
    whereIs(g, g.world.balls[id]).ring !== ring - 1;

export const on =
  (id: number, ring: number) =>
  (g: Game): boolean =>
    whereIs(g, g.world.balls[id]).ring === ring - 1;

/** 球已经掉到第一层以下（或已出界） */
export const below =
  (id: number, y: number) =>
  (g: Game): boolean =>
    !g.world.balls[id].alive || g.world.balls[id].y > y;

export const calm = (g: Game): boolean =>
  g.world.balls.every((b) => !b.alive || Math.hypot(b.vx, b.vy) < 0.05);

export const SCRIPTS: Record<number, Record<string, Step[]>> = {
  0: {
    solve: [
      { turn: -70, rate: 40, until: left(0, 1), label: '向左转，让篮球从上层右端滚落' },
      { hold: 2, until: (g) => on(0, 2)(g) && calm(g), label: '等篮球在下层停稳' },
      { turn: 0, rate: 20, label: '慢慢转回，把篮筐送到球下' },
    ],
    left: [
      { turn: 70, rate: 40, until: left(0, 1), label: '向右转，让篮球从上层左端滚落' },
      { hold: 2, until: (g) => on(0, 2)(g) && calm(g) },
      { turn: -30, rate: 20, label: '转回，把篮筐送到球下' },
    ],
  },
  1: {
    solve: [
      { turn: -34, rate: 22, until: out('volleyball', 2), label: '向左转，把两个排球从下层右端倒掉' },
      { hold: 2.5, until: out('volleyball', 2), label: '等两个排球都掉下去' },
      { turn: 60, rate: 30, until: left(0, 1), label: '向右转，让篮球从上层左端落到下层' },
      { hold: 2.5, until: (g) => on(0, 2)(g) && calm(g), label: '等篮球停稳' },
      { turn: 20, rate: 14, label: '回转，把篮筐送到篮球下方' },
      { hold: 1.5 },
    ],
  },
  2: {
    solve: [
      { turn: -30, rate: 16, label: '向左转，让右侧的排球从尽头滚落' },
      { hold: 1.5, label: '等一等' },
      { turn: -44, rate: 7, until: out('volleyball', 4), label: '再慢慢多转一点，倒掉剩下的排球' },
      { turn: 0, rate: 30, label: '回正' },
      { turn: 48, rate: 22, until: left(0, 1), label: '向右转，篮球从左端落到下层' },
      { hold: 2.5, until: (g) => on(0, 2)(g) && calm(g), label: '等篮球停稳' },
      { turn: 70, rate: 14, label: '把篮筐送到篮球下方' },
      { hold: 1.5 },
    ],
  },
  3: {
    solve: [
      { turn: -32, rate: 16, until: left(2, 1), label: '向左转，放下右边的排球' },
      { turn: 0, rate: 16, until: out('volleyball', 1), label: '回正，让它从暗道漏下去' },
      { hold: 1.5, until: out('volleyball', 1) },
      { turn: 32, rate: 16, until: left(0, 1), label: '向右转，放下左边的排球' },
      { turn: 0, rate: 16, until: out('volleyball', 2), label: '回正，冲走第二个排球' },
      { hold: 1.5, until: out('volleyball', 2) },
      { turn: -46, rate: 20, until: left(1, 1), label: '向左转，篮球从上层右端落下' },
      { hold: 2.5, until: (g) => on(1, 2)(g) && calm(g), label: '等篮球在第二层停稳' },
      { turn: -70, rate: 12, until: left(1, 2), label: '继续向左，篮球穿过右边的缺口' },
      { hold: 2.5, until: (g) => on(1, 3)(g) && calm(g), label: '等篮球在第三层停稳' },
      { turn: -30, rate: 12, label: '回转，把篮筐送到篮球下方' },
      { hold: 1.5 },
    ],
  },
  4: {
    solve: [
      { turn: -36, rate: 20, until: out('volleyball', 2), label: '向左转：蓝色轨道反向，把排球从它的左端倒掉' },
      { hold: 1.5, until: out('volleyball', 2) },
      { turn: 60, rate: 24, until: left(0, 1), label: '向右转，篮球从上层左端落下' },
      { hold: 3 },
      { turn: 20, rate: 12, label: '如果没直接进筐，回转把篮筐送过来' },
      { hold: 1.5 },
    ],
  },
  5: {
    solve: [
      { turn: -32, rate: 16, label: '向左转，排球从上层右端落到蓝色轨道上' },
      { hold: 2.5, until: (g) => [1, 2, 3, 4].every((id) => on(id, 2)(g)) && calm(g), label: '等排球都落稳' },
      { turn: 34, rate: 16, until: out('volleyball', 4), label: '向右转：蓝色轨道反向，把排球从它的右端甩出去' },
      { hold: 2, until: out('volleyball', 4) },
      { turn: 68, rate: 18, until: left(0, 1), label: '继续向右，篮球从上层左端落下，直坠篮筐' },
      { hold: 3 },
    ],
  },
  6: {
    solve: [
      { turn: -22, rate: 12, label: '向左转一点，右侧的排球落到第二层' },
      { hold: 1.5 },
      { turn: 46, rate: 12, until: (g) => below(0, 0.7)(g) && below(3, 0.7)(g), label: '向右转：经过正中时暗道把排球漏走，左侧的排球落下' },
      { hold: 1.2 },
      { turn: 0, rate: 12, until: out('volleyball', 5), label: '回正，把剩下的排球也漏走' },
      { hold: 2, until: out('volleyball', 5) },
      { turn: -44, rate: 18, until: left(1, 1), label: '向左转，篮球从上层右端落下' },
      { hold: 2.5, until: (g) => on(1, 2)(g) && calm(g), label: '等篮球在第二层停稳' },
      { turn: -70, rate: 12, until: left(1, 2), label: '继续向左，篮球穿过第二层右边的缺口' },
      { hold: 2.5, until: (g) => on(1, 3)(g) && calm(g), label: '等篮球在第三层停稳' },
      { turn: -25, rate: 12, label: '回转：篮球穿过第三层的缺口，落进篮筐' },
      { hold: 2 },
    ],
  },
};
