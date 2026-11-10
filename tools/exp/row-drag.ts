// 实验：一排挨着的球，在匀速转动的碗里会被带偏多少度？
import { rowOnRing } from '../../src/game/level';
import { TICK, World, deg } from '../../src/physics/world';

const toDeg = (r: number): number => (r * 180) / Math.PI;
for (const mu of [0.6, 0.3, 0.2, 0.12, 0.05]) {
  for (const rate of [10, 20, 40]) {
    const w = new World();
    w.ballFriction = mu;
    w.rigDrive = 'manual';
    w.addArc({ r: 0.62, a0: deg(-175), a1: deg(175) });
    for (const b of rowOnRing(0.62, 0, ['volleyball', 'basketball', 'volleyball'])) w.addBall(b);
    for (let i = 0; i < 240; i++) w.step(TICK);
    w.rigOmega = -deg(rate);
    let maxDrag = 0;
    const n = Math.round(40 / rate / TICK);
    for (let i = 0; i < n; i++) {
      w.step(TICK);
      maxDrag = Math.max(maxDrag, -toDeg(Math.atan2(w.balls[1].x, w.balls[1].y)));
    }
    const end = -toDeg(Math.atan2(w.balls[1].x, w.balls[1].y));
    console.log(`球间摩擦 ${mu.toFixed(2)}  转速 ${String(rate).padStart(2)}°/s 转 40°：篮球最多被带偏 ${maxDrag.toFixed(1)}°，结束时 ${end.toFixed(1)}°`);
  }
}
