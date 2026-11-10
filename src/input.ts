/**
 * 拖动手势的指针记账：记住每根按着的手指的位置，由最后按下的那根说了算。
 * 两个拇指交替"倒手"时，新落下的手指立刻接管；它抬起后，还按着的那根接回来。
 * 只算位移，不碰 DOM，方便单独测试。
 */
export class DragTracker {
  /** 按着的指针 → 它最后的横坐标。Map 保持插入顺序，最后一项就是最晚按下的 */
  private points = new Map<number, number>();
  private active: number | null = null;

  get dragging(): boolean {
    return this.points.size > 0;
  }

  down(id: number, x: number): void {
    this.points.delete(id);
    this.points.set(id, x);
    this.active = id;
  }

  /** 指针移动。返回这次移动带来的水平位移（不是当前主导的指针则为 0） */
  move(id: number, x: number): number {
    const last = this.points.get(id);
    if (last === undefined) return 0;
    this.points.set(id, x);
    return id === this.active ? x - last : 0;
  }

  up(id: number): void {
    if (!this.points.delete(id) || id !== this.active) return;
    let latest: number | null = null;
    for (const key of this.points.keys()) latest = key;
    this.active = latest;
  }

  reset(): void {
    this.points.clear();
    this.active = null;
  }
}
