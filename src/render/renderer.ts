import type { Game } from '../game/game';
import { HOOP_GAP_CLEAR, type Level } from '../game/level';
import { RAIL_HALF } from '../physics/world';
import type { Fx } from './fx';
import type { Net } from './net';
import { ballSprite, shadeSprite } from './sprites';

export interface Camera {
  /** 每米多少 CSS 像素 */
  scale: number;
  /** 转盘圆心在屏幕上的位置（CSS 像素） */
  cx: number;
  cy: number;
}

export interface Frame {
  game: Game;
  /** 插值后的转盘角度 */
  rigAngle: number;
  /** 两个物理 tick 之间的插值系数 0~1 */
  alpha: number;
  net: Net;
  fx: Fx;
}

const WALL = '#1e5a4d';
const SHADOW = 'rgba(6, 28, 22, 0.3)';
/** 影子相对物体的偏移（米）：光从左上方来 */
const SHADOW_DX = 0.02;
const SHADOW_DY = 0.036;
const RAIL = {
  normal: { edge: '#7a4c20', top: '#e0b06a', light: '#f7ddab', arm: '#174a3e', armLight: '#2a6b5b' },
  reverse: { edge: '#173f6e', top: '#4a86cd', light: '#a4c9f0', arm: '#1a4468', armLight: '#366a9f' },
};
/** 筐沿椭圆的短半轴：模拟从略高处看篮筐的透视 */
const RIM_MINOR = 0.048;
const NET_KNOTS = 10;

/** 把关卡取景框放进当前视口 */
export function fitCamera(vw: number, vh: number, view: Level['view']): Camera {
  const height = view.bottom - view.top;
  const scale = Math.min(vh / height, vw / view.minWidth);
  // 视口比取景框更高时，多出来的空间上少下多
  const spare = vh - scale * height;
  return { scale, cx: vw / 2, cy: spare * 0.42 - view.top * scale };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement = document.createElement('canvas');
  private bgKey = '';
  private vw = 1;
  private vh = 1;
  private dpr = 1;
  cam: Camera = { scale: 100, cx: 0, cy: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(vw: number, vh: number, dpr: number): void {
    this.vw = vw;
    this.vh = vh;
    this.dpr = dpr;
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);
    this.bgKey = '';
  }

  setView(view: Level['view']): void {
    this.cam = fitCamera(this.vw, this.vh, view);
    this.bgKey = '';
  }

  draw(frame: Frame): void {
    const { ctx, cam, dpr } = this;
    const { game, rigAngle, alpha } = frame;
    const level = game.level;
    this.drawBackground(level);

    const k = cam.scale * dpr;
    ctx.setTransform(k, 0, 0, k, cam.cx * dpr, cam.cy * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 影子：支架、弧轨、球都投在墙面上
    ctx.save();
    ctx.translate(SHADOW_DX, SHADOW_DY);
    ctx.strokeStyle = SHADOW;
    ctx.fillStyle = SHADOW;
    for (const t of level.tracks) this.armPath(t, rigAngle, 0.016);
    for (const t of level.tracks) this.railPath(t, rigAngle, RAIL_HALF * 2);
    for (const b of game.world.balls) {
      if (!b.alive) continue;
      ctx.beginPath();
      ctx.arc(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 支架与轴心
    for (const t of level.tracks) {
      const c = t.gear < 0 ? RAIL.reverse : RAIL.normal;
      ctx.strokeStyle = c.arm;
      this.armPath(t, rigAngle, 0.02);
      ctx.strokeStyle = c.armLight;
      this.armPath(t, rigAngle, 0.005);
    }
    this.drawHub(level, rigAngle);

    // 弧轨
    for (const t of level.tracks) {
      const c = t.gear < 0 ? RAIL.reverse : RAIL.normal;
      ctx.strokeStyle = c.edge;
      this.railPath(t, rigAngle, RAIL_HALF * 2);
      ctx.strokeStyle = c.top;
      this.railPath(t, rigAngle, RAIL_HALF * 2 - 0.012);
      // 朝上那一侧的受光边
      ctx.strokeStyle = c.light;
      ctx.globalAlpha = 0.75;
      this.railPath(t, rigAngle, 0.007, -RAIL_HALF * 0.42, 0.012);
      ctx.globalAlpha = 1;
    }

    const hoopAngle = level.hoop.at + level.hoop.gear * rigAngle;
    this.drawHoop(frame, hoopAngle, false);

    // 球
    for (const b of game.world.balls) {
      if (!b.alive) continue;
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      const angle = b.pa + (b.a - b.pa) * alpha;
      const sprite = ballSprite(b.kind, b.r * k);
      const size = sprite.size / k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(sprite.canvas, -size / 2, -size / 2, size, size);
      ctx.restore();
      const shade = shadeSprite(b.r * k);
      ctx.drawImage(shade.canvas, x - size / 2, y - size / 2, size, size);
    }

    this.drawHoop(frame, hoopAngle, true);
    frame.fx.draw(ctx);
    this.drawHoopPointer(level.hoop.chordDist * Math.sin(hoopAngle), level.hoop.chordDist * Math.cos(hoopAngle));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 篮筐转到画面外时，在屏幕边缘画一个小筐加箭头，告诉玩家它在哪边 */
  private drawHoopPointer(wx: number, wy: number): void {
    const { ctx, cam, dpr, vw, vh } = this;
    const sx = cam.cx + wx * cam.scale;
    const sy = cam.cy + wy * cam.scale;
    const pad = 30;
    const top = 118;
    if (sx > 6 && sx < vw - 6 && sy > top - 40 && sy < vh - 6) return;
    // 从轴心朝篮筐的方向走，停在屏幕内缘
    const dx = sx - cam.cx;
    const dy = sy - cam.cy;
    let t = 1;
    if (dx > 0) t = Math.min(t, (vw - pad - cam.cx) / dx);
    if (dx < 0) t = Math.min(t, (pad - cam.cx) / dx);
    if (dy > 0) t = Math.min(t, (vh - pad - cam.cy) / dy);
    if (dy < 0) t = Math.min(t, (top - cam.cy) / dy);
    const px = cam.cx + dx * t;
    const py = cam.cy + dy * t;
    const a = Math.atan2(dy, dx);
    ctx.setTransform(dpr, 0, 0, dpr, px * dpr, py * dpr);
    ctx.fillStyle = 'rgba(13, 42, 34, 0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f4702f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -1, 9, 4.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(248, 245, 234, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const x of [-6, -2, 2, 6]) {
      ctx.moveTo(x, 2.5);
      ctx.lineTo(x * 0.55, 10);
    }
    ctx.stroke();
    ctx.rotate(a);
    ctx.fillStyle = '#f4702f';
    ctx.beginPath();
    ctx.moveTo(29, 0);
    ctx.lineTo(22, -6);
    ctx.lineTo(22, 6);
    ctx.closePath();
    ctx.fill();
  }

  // ---------------------------------------------------------------- 背景

  private drawBackground(level: Level): void {
    const { ctx, cam, dpr, vw, vh } = this;
    const key = `${level.index}:${vw}x${vh}@${dpr}:${cam.scale.toFixed(3)}`;
    if (key !== this.bgKey) {
      this.bgKey = key;
      this.bg.width = this.canvas.width;
      this.bg.height = this.canvas.height;
      const b = this.bg.getContext('2d')!;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = WALL;
      b.fillRect(0, 0, vw, vh);
      // 顶灯打在墙上的一片亮
      const glow = b.createRadialGradient(cam.cx, cam.cy - vh * 0.1, 0, cam.cx, cam.cy, Math.max(vw, vh) * 0.85);
      glow.addColorStop(0, 'rgba(255, 244, 214, 0.13)');
      glow.addColorStop(0.55, 'rgba(255, 244, 214, 0.02)');
      glow.addColorStop(1, 'rgba(0, 12, 8, 0.28)');
      b.fillStyle = glow;
      b.fillRect(0, 0, vw, vh);
      // 乳胶漆墙面的细颗粒
      let seed = 20261110;
      const rand = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const dots = Math.round((vw * vh) / 260);
      for (let i = 0; i < dots; i++) {
        b.fillStyle = rand() < 0.5 ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.05)';
        b.fillRect(rand() * vw, rand() * vh, 1.2, 1.2);
      }
      // 每圈轨道扫过的圆：像球场上的画线，方便看出缺口会转到哪里
      b.translate(cam.cx, cam.cy);
      b.lineWidth = 1.25;
      for (const ring of level.rings) {
        b.strokeStyle = 'rgba(232, 244, 236, 0.09)';
        b.beginPath();
        b.arc(0, 0, ring.r * cam.scale, 0, Math.PI * 2);
        b.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
  }

  // ---------------------------------------------------------------- 转盘

  /** 画一段弧轨。canvas 的角度从 +x 轴顺时针量，这里的角度从正下方向右量，换算关系是 θ = π/2 - a */
  private railPath(
    t: { r: number; a0: number; a1: number; gear: number },
    rig: number,
    width: number,
    radial = 0,
    trim = 0,
  ): void {
    const ctx = this.ctx;
    const turn = t.gear * rig;
    const cut = trim / t.r;
    if (t.a1 - t.a0 - 2 * cut <= 0) return;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, t.r + radial, Math.PI / 2 - (t.a0 + turn + cut), Math.PI / 2 - (t.a1 + turn - cut), true);
    ctx.stroke();
  }

  /** 从轴心伸出去托住弧轨的支架 */
  private armPath(t: { r: number; a0: number; a1: number; gear: number }, rig: number, width: number): void {
    const ctx = this.ctx;
    const a = (t.a0 + t.a1) / 2 + t.gear * rig;
    const s = Math.sin(a);
    const c = Math.cos(a);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(s * 0.05, c * 0.05);
    ctx.lineTo(s * (t.r - RAIL_HALF * 0.5), c * (t.r - RAIL_HALF * 0.5));
    ctx.stroke();
  }

  private drawHub(level: Level, rig: number): void {
    const ctx = this.ctx;
    const hasReverse = level.tracks.some((t) => t.gear < 0);
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(SHADOW_DX, SHADOW_DY, 0.085, 0, Math.PI * 2);
    ctx.fill();
    if (hasReverse) {
      // 反向那组轨道的齿圈，朝相反方向转
      ctx.fillStyle = RAIL.reverse.arm;
      ctx.beginPath();
      ctx.arc(0, 0, 0.085, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = RAIL.reverse.light;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(Math.sin(-rig) * 0.058, Math.cos(-rig) * 0.058);
      ctx.lineTo(Math.sin(-rig) * 0.08, Math.cos(-rig) * 0.08);
      ctx.stroke();
    } else {
      ctx.fillStyle = RAIL.normal.arm;
      ctx.beginPath();
      ctx.arc(0, 0, 0.085, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = RAIL.normal.edge;
    ctx.beginPath();
    ctx.arc(0, 0, 0.056, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = RAIL.normal.top;
    ctx.beginPath();
    ctx.arc(0, 0, 0.046, 0, Math.PI * 2);
    ctx.fill();
    // 轴心上的一字槽，跟着转盘转，能看出转了多少
    ctx.strokeStyle = RAIL.normal.edge;
    ctx.lineWidth = 0.011;
    ctx.beginPath();
    ctx.moveTo(-Math.sin(rig) * 0.03, -Math.cos(rig) * 0.03);
    ctx.lineTo(Math.sin(rig) * 0.03, Math.cos(rig) * 0.03);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- 篮筐与球网

  private drawHoop(frame: Frame, angle: number, front: boolean): void {
    const ctx = this.ctx;
    const hoop = frame.game.level.hoop;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const cx = hoop.chordDist * s;
    const cy = hoop.chordDist * c;
    const hw = hoop.halfWidth + hoop.rimRad;

    if (!front) {
      // 吊杆：从缺口两端的轨道头垂到筐沿
      const gapHalf = (HOOP_GAP_CLEAR / 2 + RAIL_HALF) / hoop.ringR;
      ctx.strokeStyle = '#0f342b';
      ctx.lineWidth = 0.016;
      for (const side of [-1, 1]) {
        const ta = angle + side * gapHalf;
        const da = angle + side * hoop.rimOffset;
        ctx.beginPath();
        ctx.moveTo(hoop.ringR * Math.sin(ta), hoop.ringR * Math.cos(ta));
        ctx.lineTo(hoop.rimR * Math.sin(da), hoop.rimR * Math.cos(da));
        ctx.stroke();
      }
    }

    this.drawNet(frame.net, s, c, front);

    // 筐沿：一个压扁的椭圆，后半圈在球后面，前半圈在球前面
    const from = front ? 0 : Math.PI;
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const th = from + (Math.PI * i) / 18;
      const u = -hw * Math.cos(th);
      const v = RIM_MINOR * Math.sin(th);
      const x = cx + c * u + s * v;
      const y = cy - s * u + c * v;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = front ? '#b8421a' : '#8f3414';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.strokeStyle = front ? '#f4702f' : '#c2501f';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    if (front) {
      ctx.strokeStyle = 'rgba(255, 196, 150, 0.8)';
      ctx.lineWidth = 0.005;
      ctx.stroke();
    }
  }

  private drawNet(net: Net, s: number, c: number, front: boolean): void {
    const ctx = this.ctx;
    const rows = net.rows;
    const topWidth = Math.hypot(net.x[rows] - net.x[0], net.y[rows] - net.y[0]) || 1;
    /** 第 i 行、第 j 个网结的屏幕位置；返回它在圆筒上的前后位置（>0 为朝向观众） */
    const knot = (i: number, j: number, out: [number, number]): number => {
      const th = (Math.PI * 2 * (j + (i % 2 ? 0.5 : 0))) / NET_KNOTS;
      const t = (1 - Math.cos(th)) / 2;
      const lx = net.x[i];
      const ly = net.y[i];
      const rx = net.x[rows + i];
      const ry = net.y[rows + i];
      const width = Math.hypot(rx - lx, ry - ly);
      const depth = Math.sin(th);
      const lift = depth * RIM_MINOR * (width / topWidth);
      out[0] = lx + (rx - lx) * t + s * lift;
      out[1] = ly + (ry - ly) * t + c * lift;
      return depth;
    };
    const p: [number, number] = [0, 0];
    const q: [number, number] = [0, 0];
    ctx.strokeStyle = front ? 'rgba(248, 245, 234, 0.96)' : 'rgba(196, 214, 204, 0.6)';
    ctx.lineWidth = front ? 0.0085 : 0.007;
    ctx.beginPath();
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < NET_KNOTS; j++) {
        const d0 = knot(i, j, p);
        for (const dj of i % 2 ? [0, 1] : [0, -1]) {
          const d1 = knot(i + 1, (j + dj + NET_KNOTS) % NET_KNOTS, q);
          if (d0 + d1 > 0 !== front) continue;
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        }
      }
    }
    ctx.stroke();
  }
}
