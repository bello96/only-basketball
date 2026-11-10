import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { LEVELS } from '../src/game/levels';
import { DragTracker } from '../src/input';
import { deg } from '../src/physics/world';
import { Net } from '../src/render/net';
import { edgeBadge } from '../src/render/renderer';
import { type Progress, recordWin } from '../src/storage';

describe('拖动手势', () => {
  it('单指拖动：只报告相对位移', () => {
    const drag = new DragTracker();
    expect(drag.dragging).toBe(false);
    drag.down(1, 100);
    expect(drag.dragging).toBe(true);
    expect(drag.move(1, 130)).toBe(30);
    expect(drag.move(1, 120)).toBe(-10);
    drag.up(1);
    expect(drag.dragging).toBe(false);
    expect(drag.move(1, 300)).toBe(0);
  });

  it('第二根手指落下就由它接管（两个拇指交替"倒手"时不用先抬起再放下）', () => {
    const drag = new DragTracker();
    drag.down(1, 100);
    drag.down(2, 300);
    expect(drag.move(1, 150)).toBe(0);
    expect(drag.move(2, 320)).toBe(20);
  });

  it('接管的手指抬起后，还按着的那根接回来，位移不跳变', () => {
    const drag = new DragTracker();
    drag.down(1, 100);
    expect(drag.move(1, 150)).toBe(50);
    drag.down(2, 300);
    // 第一根手指此时不起作用，但它的位置一直被记着
    expect(drag.move(1, 180)).toBe(0);
    drag.up(2);
    expect(drag.dragging).toBe(true);
    expect(drag.move(1, 190)).toBe(10);
    drag.up(1);
    expect(drag.dragging).toBe(false);
  });

  it('没按下过的指针的移动和抬起都被忽略', () => {
    const drag = new DragTracker();
    expect(drag.move(9, 50)).toBe(0);
    drag.up(9);
    drag.down(1, 10);
    drag.up(9);
    expect(drag.move(1, 25)).toBe(15);
    drag.reset();
    expect(drag.dragging).toBe(false);
    expect(drag.move(1, 40)).toBe(0);
  });
});

describe('通关记录', () => {
  const fresh = (): Progress => ({ best: [], stars: [], unlocked: 0, sound: true });

  it('第一次通关：记下成绩和星级，解锁下一关', () => {
    const p = fresh();
    expect(recordWin(p, 0, 8.5, 2, 7)).toEqual({ previous: null, record: true });
    expect(p.best[0]).toBe(8.5);
    expect(p.stars[0]).toBe(2);
    expect(p.unlocked).toBe(1);
  });

  it('再打一次更慢：成绩和星级保留最好的那次', () => {
    const p = fresh();
    recordWin(p, 0, 6, 3, 7);
    expect(recordWin(p, 0, 9, 1, 7)).toEqual({ previous: 6, record: false });
    expect(p.best[0]).toBe(6);
    expect(p.stars[0]).toBe(3);
  });

  it('刷新纪录：返回旧成绩，方便界面说明', () => {
    const p = fresh();
    recordWin(p, 2, 20, 2, 7);
    expect(recordWin(p, 2, 14.2, 3, 7)).toEqual({ previous: 20, record: true });
    expect(p.best[2]).toBe(14.2);
    expect(p.stars[2]).toBe(3);
    expect(p.unlocked).toBe(3);
  });

  it('重打前面的关不会让已解锁的进度倒退，最后一关之后没有下一关', () => {
    const p = fresh();
    p.unlocked = 5;
    recordWin(p, 1, 10, 3, 7);
    expect(p.unlocked).toBe(5);
    recordWin(p, 6, 30, 3, 7);
    expect(p.unlocked).toBe(6);
  });
});

describe('画面外篮筐的指示', () => {
  const screen = { vw: 390, vh: 844, pad: 30, top: 118 };

  it('篮筐在画面里时不显示', () => {
    expect(edgeBadge(screen, 195, 300, 250, 600)).toBeNull();
  });

  it('篮筐在右侧画面外：贴着右边缘，并指向篮筐', () => {
    const badge = edgeBadge(screen, 195, 300, 600, 500)!;
    expect(badge.x).toBeCloseTo(390 - 30, 6);
    // 仍在轴心到篮筐的连线上
    expect((badge.y - 300) / (badge.x - 195)).toBeCloseTo((500 - 300) / (600 - 195), 6);
    expect(badge.angle).toBeCloseTo(Math.atan2(200, 405), 6);
  });

  it('横屏时轴心比顶栏还高：指示仍然在篮筐那一侧，不会被镜像到对面', () => {
    const wide = { vw: 740, vh: 340, pad: 30, top: 118 };
    // 轴心在 (370, 60)，篮筐在右上方画面外
    const badge = edgeBadge(wide, 370, 60, 900, -40)!;
    expect(badge.x).toBeGreaterThan(370);
    expect(badge.x).toBeLessThanOrEqual(740 - 30);
    expect(badge.y).toBeGreaterThanOrEqual(118);
    expect(badge.y).toBeLessThanOrEqual(340 - 30);
  });

  it('不管轴心和篮筐在哪，指示都落在安全区内', () => {
    const wide = { vw: 740, vh: 340, pad: 30, top: 118 };
    for (const [sx, sy] of [
      [-300, 50],
      [-300, 900],
      [1200, 900],
      [370, -500],
      [370, 2000],
    ]) {
      const badge = edgeBadge(wide, 370, 60, sx, sy)!;
      expect(badge.x).toBeGreaterThanOrEqual(30);
      expect(badge.x).toBeLessThanOrEqual(710);
      expect(badge.y).toBeGreaterThanOrEqual(118);
      expect(badge.y).toBeLessThanOrEqual(310);
    }
  });
});

describe('球网', () => {
  it('记着上一 tick 的节点位置（含钉在筐沿上的两个点），渲染时才能和筐沿一起插值', () => {
    const game = new Game(LEVELS[0], { settle: true });
    const net = new Net(game.level.hoop);
    net.reset(game);
    const rows = net.rows;
    const before = { lx: net.x[0], ly: net.y[0], rx: net.x[rows], ry: net.y[rows], mx: net.x[3], my: net.y[3] };
    // 转盘转过 10°，筐沿跟着动
    game.world.rigAngle += deg(10);
    net.step(game);
    expect(net.x[0]).not.toBeCloseTo(before.lx, 4);
    expect(net.px[0]).toBe(before.lx);
    expect(net.py[0]).toBe(before.ly);
    expect(net.px[rows]).toBe(before.rx);
    expect(net.py[rows]).toBe(before.ry);
    expect(net.px[3]).toBe(before.mx);
    expect(net.py[3]).toBe(before.my);
  });
});
