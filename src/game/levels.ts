import { type Level, type LevelSpec, compileLevel, rowOnRing } from './level';

/**
 * 关卡表。角度单位为度（转盘坐标系：0 为正下方，向右为正）。
 * 设计思路见 README「关卡是怎么设计的」。
 */
const SPECS: LevelSpec[] = [
  {
    name: '热身',
    hint: '左右拖动，转动弧轨。把篮球送进篮筐。',
    maxTilt: 70,
    rings: [
      { r: 0.62, span: [-55, 55] },
      { r: 1.02, span: [-80, 80] },
    ],
    hoop: { ring: 1, at: 30 },
    balls: rowOnRing(0.62, 0, ['basketball']),
    par: [7, 12],
  },
  {
    name: '清场',
    hint: '排球先进筐就输了。先把它们从右边的尽头倒掉，再放篮球下来。',
    maxTilt: 70,
    rings: [
      { r: 0.62, span: [-50, 80] },
      { r: 1.02, span: [-100, 28] },
    ],
    hoop: { ring: 1, at: -30 },
    balls: [...rowOnRing(0.62, 0, ['basketball']), ...rowOnRing(1.02, 0, ['volleyball', 'volleyball'])],
    par: [11, 20],
  },
  {
    name: '抽丝',
    hint: '右边尽头下面是空的。把排球全倒掉，再带着篮球从左边下去。',
    maxTilt: 70,
    rings: [
      { r: 0.62, span: [-40, 45] },
      { r: 1.02, span: [-100, 10] },
    ],
    hoop: { ring: 1, at: -66 },
    balls: [
      ...rowOnRing(0.62, 0, ['basketball', 'volleyball', 'volleyball']),
      { kind: 'volleyball', x: -0.11, y: 0.3 },
      { kind: 'volleyball', x: 0.12, y: 0.3 },
    ],
    par: [11, 20],
  },
  {
    name: '暗道',
    hint: '中间上下对齐的缺口直通到底。把排球冲下去，篮球要走右边的缺口。',
    maxTilt: 70,
    rings: [
      { r: 0.62, span: [-40, 40] },
      { r: 1.02, span: [-85, 90], gaps: [[0, 0.3], [72, 0.3]] },
      { r: 1.42, span: [-85, 85], gaps: [[0, 0.5]] },
    ],
    hoop: { ring: 2, at: 38 },
    balls: rowOnRing(0.62, 0, ['volleyball', 'basketball', 'volleyball']),
    par: [23, 40],
  },
  {
    name: '反着来',
    hint: '蓝色的轨道朝相反方向转。',
    maxTilt: 70,
    rings: [
      { r: 0.62, span: [-50, 80] },
      { r: 1.02, span: [-28, 100], gear: -1 },
    ],
    hoop: { ring: 1, at: 42.5 },
    balls: [...rowOnRing(0.62, 0, ['basketball']), ...rowOnRing(1.02, 0, ['volleyball', 'volleyball'])],
    par: [10, 18],
  },
  {
    name: '对开',
    hint: '排球先倒到蓝色轨道上，再反方向把它们甩出去。',
    maxTilt: 75,
    rings: [
      { r: 0.62, span: [-60, 45] },
      { r: 1.02, span: [-100, 22], gear: -1 },
      { r: 1.42, span: [-110, -40] },
    ],
    hoop: { ring: 2, at: -65 },
    balls: [
      ...rowOnRing(0.62, 0, ['basketball', 'volleyball', 'volleyball']),
      { kind: 'volleyball', x: -0.11, y: 0.3 },
      { kind: 'volleyball', x: 0.12, y: 0.3 },
    ],
    par: [15, 28],
  },
  {
    name: '大满贯',
    hint: '排球倒下去之后，回正就能从中间的暗道漏走。篮球要一路向右。',
    maxTilt: 70,
    rings: [
      { r: 0.62, span: [-45, 38] },
      { r: 1.02, span: [-85, 90], gaps: [[0, 0.3], [72, 0.3]] },
      { r: 1.42, span: [-85, 85], gaps: [[0, 0.5], [30, 0.32]] },
      { r: 1.82, span: [14, 80] },
    ],
    hoop: { ring: 3, at: 31 },
    balls: [
      ...rowOnRing(0.62, 0, ['volleyball', 'basketball', 'volleyball']),
      { kind: 'volleyball', x: -0.115, y: 0.29 },
      { kind: 'volleyball', x: 0.115, y: 0.29 },
      { kind: 'volleyball', x: 0, y: 0.1 },
    ],
    par: [32, 55],
  },
];

export const LEVELS: Level[] = SPECS.map(compileLevel);
