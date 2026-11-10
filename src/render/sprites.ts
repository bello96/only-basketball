import type { BallKind } from '../physics/world';

/** 预渲染的球贴图：画一次，之后每帧只做旋转贴图 */
export interface Sprite {
  canvas: HTMLCanvasElement;
  /** 贴图边长（设备像素） */
  size: number;
}

const cache = new Map<string, Sprite>();

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  return [canvas, ctx];
}

function drawBasketball(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = '#e8792c';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 球皮上的细颗粒
  ctx.fillStyle = 'rgba(120, 48, 8, 0.16)';
  const step = Math.max(2.2, R * 0.13);
  for (let y = -R, row = 0; y <= R; y += step, row++) {
    for (let x = -R + (row % 2 ? step / 2 : 0); x <= R; x += step) {
      ctx.fillRect(x, y, Math.max(0.7, R * 0.028), Math.max(0.7, R * 0.028));
    }
  }
  // 球缝：一横一竖，加左右两道弧
  ctx.strokeStyle = '#26150d';
  ctx.lineWidth = Math.max(1.3, R * 0.085);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -R);
  ctx.lineTo(0, R);
  ctx.moveTo(-R, 0);
  ctx.lineTo(R, 0);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * 1.78 * R, 0, 1.22 * R, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVolleyball(ctx: CanvasRenderingContext2D, R: number): void {
  const blades = ['#f6f2e6', '#2b5fb6', '#f1bf2b'];
  const seam = (k: number): [number, number, number, number] => {
    const t = (k * Math.PI * 2) / 3;
    const end = t + (50 * Math.PI) / 180;
    return [0.62 * R * Math.cos(t), 0.62 * R * Math.sin(t), R * 1.05 * Math.cos(end), R * 1.05 * Math.sin(end)];
  };
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = blades[0];
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 三片风车状的球皮
  for (let k = 0; k < 3; k++) {
    const [c1x, c1y, e1x, e1y] = seam(k);
    const [c2x, c2y, e2x, e2y] = seam(k + 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(c1x, c1y, e1x, e1y);
    const a1 = Math.atan2(e1y, e1x);
    let a2 = Math.atan2(e2y, e2x);
    if (a2 < a1) a2 += Math.PI * 2;
    ctx.arc(0, 0, R * 1.05, a1, a2);
    ctx.quadraticCurveTo(c2x, c2y, 0, 0);
    ctx.closePath();
    ctx.fillStyle = blades[k];
    ctx.fill();
  }
  // 球缝，以及每片球皮里再分出的一道平行缝
  ctx.strokeStyle = 'rgba(22, 30, 46, 0.62)';
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const [cx, cy, ex, ey] = seam(k);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    const t = (k * Math.PI * 2) / 3 + (62 * Math.PI) / 180;
    const from = t + (4 * Math.PI) / 180;
    const to = t + (44 * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(0.42 * R * Math.cos(from), 0.42 * R * Math.sin(from));
    ctx.quadraticCurveTo(0.8 * R * Math.cos(t + 0.2), 0.8 * R * Math.sin(t + 0.2), R * 1.05 * Math.cos(to), R * 1.05 * Math.sin(to));
    ctx.stroke();
  }
  ctx.restore();
}

/** 球面贴图（会随球一起旋转） */
export function ballSprite(kind: BallKind, radiusPx: number): Sprite {
  const R = Math.max(4, Math.round(radiusPx));
  const key = `${kind}:${R}`;
  let sprite = cache.get(key);
  if (!sprite) {
    const size = R * 2 + 4;
    const [canvas, ctx] = makeCanvas(size);
    if (kind === 'basketball') drawBasketball(ctx, R);
    else drawVolleyball(ctx, R);
    sprite = { canvas, size };
    cache.set(key, sprite);
  }
  return sprite;
}

/** 光影罩：固定朝向的高光与暗部，叠在旋转的球面上，让球看起来是个立体的球 */
export function shadeSprite(radiusPx: number): Sprite {
  const R = Math.max(4, Math.round(radiusPx));
  const key = `shade:${R}`;
  let sprite = cache.get(key);
  if (!sprite) {
    const size = R * 2 + 4;
    const [canvas, ctx] = makeCanvas(size);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    const dark = ctx.createRadialGradient(-0.3 * R, -0.38 * R, 0.35 * R, 0, 0, 1.08 * R);
    dark.addColorStop(0, 'rgba(0, 0, 0, 0)');
    dark.addColorStop(0.62, 'rgba(0, 0, 0, 0.05)');
    dark.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = dark;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    const light = ctx.createRadialGradient(-0.36 * R, -0.42 * R, 0, -0.36 * R, -0.42 * R, 0.72 * R);
    light.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    light.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(14, 24, 20, 0.55)';
    ctx.lineWidth = Math.max(1, R * 0.045);
    ctx.beginPath();
    ctx.arc(0, 0, R - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
    sprite = { canvas, size };
    cache.set(key, sprite);
  }
  return sprite;
}
