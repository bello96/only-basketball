import { BALL_SPECS, type BallKind, RAIL_HALF, deg } from '../physics/world';

/** 篮筐内径（米）：约为篮球直径的 1.9 倍，和真实比例一致 */
export const HOOP_WIDTH = 0.46;
/** 篮筐上方轨道缺口的净宽：比筐略窄，球从缺口落下不会磕到筐沿 */
export const HOOP_GAP_CLEAR = 0.4;
/** 筐沿截面半径 */
export const RIM_RAD = 0.013;
/** 筐沿比所在轨道中心线低多少 */
export const RIM_DROP = 0.11;
/** 球网长度 */
export const NET_LEN = 0.4;

/** 一圈轨道：同一半径上的若干段弧 */
export interface RingSpec {
  /** 中心线半径（米） */
  r: number;
  /** 覆盖的角度范围（度，转盘坐标系：0 为正下方，向右为正） */
  span: [number, number];
  /** 缺口：[中心角（度）, 净宽（米）] */
  gaps?: [number, number][];
  /** 传动比：1 同向，-1 反向 */
  gear?: number;
}

export interface BallSpawn {
  kind: BallKind;
  x: number;
  y: number;
}

export interface LevelSpec {
  name: string;
  hint: string;
  /** 最大倾角（度） */
  maxTilt: number;
  rings: RingSpec[];
  /** 篮筐挂在第几圈轨道的哪个角度 */
  hoop: { ring: number; at: number };
  balls: BallSpawn[];
  /** 三星 / 两星的用时上限（秒） */
  par: [number, number];
}

export interface Track {
  ring: number;
  r: number;
  a0: number;
  a1: number;
  gear: number;
}

export interface Hoop {
  ring: number;
  /** 所在轨道半径 */
  ringR: number;
  /** 中心角（弧度，转盘坐标系） */
  at: number;
  gear: number;
  /** 两个筐沿圆点的极坐标 */
  rimR: number;
  rimOffset: number;
  /** 筐沿连线到圆心的距离 */
  chordDist: number;
  halfWidth: number;
  rimRad: number;
  netLen: number;
}

export interface Level {
  index: number;
  name: string;
  hint: string;
  maxTilt: number;
  rings: RingSpec[];
  tracks: Track[];
  hoop: Hoop;
  balls: BallSpawn[];
  par: [number, number];
  /** 画面取景（世界坐标） */
  view: { top: number; bottom: number; minWidth: number };
}

/** 把一圈轨道按缺口切成若干段弧 */
function splitRing(ring: RingSpec, index: number, extraGaps: [number, number][]): Track[] {
  const gear = ring.gear ?? 1;
  const cuts = [...(ring.gaps ?? []), ...extraGaps]
    .map(([center, clear]) => {
      // 净宽之外还要让出两端圆头的半径
      const halfAngle = (clear / 2 + RAIL_HALF) / ring.r;
      return [deg(center) - halfAngle, deg(center) + halfAngle] as [number, number];
    })
    .sort((p, q) => p[0] - q[0]);
  const tracks: Track[] = [];
  let start = deg(ring.span[0]);
  const end = deg(ring.span[1]);
  for (const [g0, g1] of cuts) {
    if (g0 > start) tracks.push({ ring: index, r: ring.r, a0: start, a1: Math.min(g0, end), gear });
    start = Math.max(start, g1);
  }
  if (end > start) tracks.push({ ring: index, r: ring.r, a0: start, a1: end, gear });
  return tracks;
}

export function compileLevel(spec: LevelSpec, index: number): Level {
  const hoopRing = spec.rings[spec.hoop.ring];
  if (!hoopRing) throw new Error(`关卡「${spec.name}」的篮筐挂在不存在的轨道上`);
  const tracks = spec.rings.flatMap((ring, i) =>
    splitRing(ring, i, i === spec.hoop.ring ? [[spec.hoop.at, HOOP_GAP_CLEAR]] : []),
  );
  const chordDist = hoopRing.r + RIM_DROP;
  const chordHalf = HOOP_WIDTH / 2 + RIM_RAD;
  const hoop: Hoop = {
    ring: spec.hoop.ring,
    ringR: hoopRing.r,
    at: deg(spec.hoop.at),
    gear: hoopRing.gear ?? 1,
    rimR: Math.hypot(chordDist, chordHalf),
    rimOffset: Math.atan2(chordHalf, chordDist),
    chordDist,
    halfWidth: HOOP_WIDTH / 2,
    rimRad: RIM_RAD,
    netLen: NET_LEN,
  };
  const maxR = Math.max(...spec.rings.map((r) => r.r));
  // 取景宽度：至少能看全最内圈的碗，并尽量让篮筐在开局时就在画面里
  const hoopX = Math.abs(chordDist * Math.sin(hoop.at));
  const minWidth = Math.min(2.7, Math.max(1.8, maxR * 1.25, 2 * (hoopX + 0.36)));
  return {
    index,
    name: spec.name,
    hint: spec.hint,
    maxTilt: deg(spec.maxTilt),
    rings: spec.rings,
    tracks,
    hoop,
    balls: spec.balls,
    par: spec.par,
    view: {
      top: -1.15,
      bottom: maxR + RIM_DROP + NET_LEN + 0.45,
      minWidth,
    },
  };
}

/**
 * 在某圈轨道上并排摆一行球，整行以 center（度）为中心。
 * 返回的坐标让球恰好贴着轨道上表面。
 */
export function rowOnRing(ringR: number, center: number, kinds: BallKind[], spacing = 0.004): BallSpawn[] {
  const widths = kinds.map((k) => BALL_SPECS[k].r * 2 + spacing);
  const total = widths.reduce((s, w) => s + w, 0);
  let cursor = -total / 2;
  return kinds.map((kind, i) => {
    const r = BALL_SPECS[kind].r;
    const orbit = ringR - RAIL_HALF - r;
    const s = cursor + widths[i] / 2;
    cursor += widths[i];
    // 弧长换算成角度：按最小的球心轨道半径算，保证相邻球之间只会略松、不会重叠
    const a = deg(center) + s / (ringR - RAIL_HALF - BALL_SPECS.basketball.r);
    return { kind, x: orbit * Math.sin(a), y: orbit * Math.cos(a) };
  });
}
