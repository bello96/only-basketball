const KEY = 'arc-hoop:progress:v1';

export interface Progress {
  /** 各关最好成绩（秒），下标为关卡序号 */
  best: (number | null)[];
  stars: number[];
  /** 已解锁到第几关（下标） */
  unlocked: number;
  sound: boolean;
}

export function loadProgress(levelCount: number): Progress {
  const fresh: Progress = { best: [], stars: [], unlocked: 0, sound: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Progress>;
      if (Array.isArray(saved.best)) fresh.best = saved.best.map((v) => (typeof v === 'number' ? v : null));
      if (Array.isArray(saved.stars)) fresh.stars = saved.stars.map((v) => Number(v) || 0);
      if (typeof saved.unlocked === 'number') fresh.unlocked = saved.unlocked;
      if (typeof saved.sound === 'boolean') fresh.sound = saved.sound;
    }
  } catch {
    // 存档读不出来就当新玩家
  }
  fresh.unlocked = Math.max(0, Math.min(levelCount - 1, Math.floor(fresh.unlocked)));
  return fresh;
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // 无痕模式等场景下存不了，不影响游玩
  }
}
