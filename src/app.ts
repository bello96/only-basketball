import { Sound } from './audio';
import { Game, type LoseReason } from './game/game';
import type { Level } from './game/level';
import { LEVELS } from './game/levels';
import { TICK, deg } from './physics/world';
import { Fx } from './render/fx';
import { Net } from './render/net';
import { Renderer } from './render/renderer';
import { type Progress, loadProgress, saveProgress } from './storage';

type Mode = 'title' | 'play';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const STAR_PATH = 'M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z';

function starsMarkup(count: number): string {
  return [1, 2, 3]
    .map((i) => `<svg viewBox="0 0 24 24" class="${i <= count ? 'is-on' : ''}"><path d="${STAR_PATH}"/></svg>`)
    .join('');
}

const seconds = (t: number): string => t.toFixed(2);

/** 标题页背景里演示用的关卡 */
const DEMO_LEVEL = 1;

const LOSE_COPY: Record<LoseReason, { title: string; detail: string }> = {
  'volleyball-scored': {
    title: '排球先进了',
    detail: '只有篮球第一个进筐才算赢。先把挡在前面的排球倒掉。',
  },
  'basketball-lost': {
    title: '篮球掉出去了',
    detail: '轨道尽头下面没有东西接着。转慢一点，篮球快到边缘时及时回转。',
  },
};

export class App {
  private renderer: Renderer;
  private sound = new Sound();
  private fx = new Fx();
  private progress: Progress;
  private mode: Mode = 'title';
  private levelIndex = 0;
  private game!: Game;
  private net!: Net;
  /** 玩家想要的转盘角度（弧度） */
  private target = 0;
  private prevRig = 0;
  private acc = 0;
  private last = 0;
  private slowUntil = 0;
  private demoClock = 0;
  private resultTimer = 0;
  private drag: { id: number; x: number } | null = null;
  private keys = { left: false, right: false, fine: false };
  private shownTime = '';

  private stage = $<HTMLCanvasElement>('stage');
  private hud = $('hud');
  private hudLevel = $('hud-level');
  private hudTime = $('hud-time');
  private hint = $('hint');
  private titleScreen = $('title');
  private levelsScreen = $('levels');
  private levelList = $('level-list');
  private result = $('result');
  private resultTitle = $('result-title');
  private resultDetail = $('result-detail');
  private resultStars = $('result-stars');
  private resultMain = $<HTMLButtonElement>('btn-result-main');
  private resultAlt = $<HTMLButtonElement>('btn-result-alt');
  private soundBtn = $<HTMLButtonElement>('btn-sound');

  constructor() {
    this.renderer = new Renderer(this.stage);
    this.progress = loadProgress(LEVELS.length);
    this.sound.enabled = this.progress.sound;
    this.soundBtn.setAttribute('aria-pressed', String(this.progress.sound));
    this.load(DEMO_LEVEL);
    this.refreshStartButton();
    this.bind();
    this.onResize();
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- 关卡流程

  private get level(): Level {
    return LEVELS[this.levelIndex];
  }

  private load(index: number): void {
    this.levelIndex = index;
    this.game = new Game(LEVELS[index], { settle: true });
    this.net = new Net(this.game.level.hoop);
    this.net.reset(this.game);
    this.fx.clear();
    this.target = 0;
    this.prevRig = 0;
    this.acc = 0;
    this.slowUntil = 0;
    this.demoClock = 0;
    window.clearTimeout(this.resultTimer);
    this.result.hidden = true;
    this.updateView();
  }

  private startLevel(index: number): void {
    this.mode = 'play';
    this.load(index);
    this.titleScreen.hidden = true;
    this.levelsScreen.hidden = true;
    this.hud.hidden = false;
    this.hudLevel.textContent = `第 ${index + 1} 关 ${this.level.name}`;
    this.hint.textContent =
      index === 0 && window.matchMedia('(hover: hover) and (pointer: fine)').matches
        ? '按住鼠标左右拖动，或者用键盘 ← → 转动弧轨。把篮球送进篮筐。'
        : this.level.hint;
    this.hint.classList.remove('is-fading');
    this.hint.hidden = false;
    this.shownTime = '';
  }

  private refreshStartButton(): void {
    $('btn-start').textContent = this.progress.unlocked > 0 ? '继续' : '开始';
  }

  private showTitle(): void {
    this.mode = 'title';
    this.load(DEMO_LEVEL);
    this.refreshStartButton();
    this.hud.hidden = true;
    this.hint.hidden = true;
    this.levelsScreen.hidden = true;
    this.titleScreen.hidden = false;
  }

  private updateView(): void {
    const view = this.level.view;
    // 标题页把转盘往下放一点、拉远一点，给标题留位置
    this.renderer.setView(
      this.mode === 'title'
        ? { top: view.top - 1.05, bottom: view.bottom + 0.35, minWidth: view.minWidth + 0.5 }
        : view,
    );
    // 屏幕比取景框高时，球要掉出屏幕底边才算出界，不能在半空消失
    const cam = this.renderer.cam;
    this.game.floorY = Math.max(view.bottom + 0.12, (window.innerHeight - cam.cy) / cam.scale + 0.02);
  }

  private openLevels(): void {
    this.levelList.innerHTML = '';
    LEVELS.forEach((level, i) => {
      const locked = i > this.progress.unlocked;
      const best = this.progress.best[i];
      const li = document.createElement('li');
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'level-card';
      card.disabled = locked;
      const meta = locked
        ? '通过上一关后解锁'
        : best != null
          ? `<span class="stars">${starsMarkup(this.progress.stars[i] ?? 0)}</span><span>最好 ${seconds(best)} 秒</span>`
          : '还没通过';
      card.innerHTML =
        `<span class="level-num">${i + 1}</span>` +
        `<span class="level-name">${level.name}</span>` +
        `<span class="level-meta">${meta}</span>`;
      card.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.click();
        this.startLevel(i);
      });
      li.append(card);
      this.levelList.append(li);
    });
    this.levelsScreen.hidden = false;
  }

  private closeLevels(): void {
    this.levelsScreen.hidden = true;
  }

  private finish(): void {
    const game = this.game;
    this.hint.hidden = true;
    if (game.status === 'won') {
      const i = this.levelIndex;
      const previous = this.progress.best[i];
      const record = previous == null || game.time < previous;
      if (record) this.progress.best[i] = game.time;
      this.progress.stars[i] = Math.max(this.progress.stars[i] ?? 0, game.stars());
      const last = i === LEVELS.length - 1;
      if (!last) this.progress.unlocked = Math.max(this.progress.unlocked, i + 1);
      saveProgress(this.progress);

      this.resultTitle.textContent = last ? '全部通关' : '进了';
      this.resultDetail.textContent =
        `用时 ${seconds(game.time)} 秒` +
        (previous == null ? '' : record ? '，刷新了自己的纪录' : `，最好成绩 ${seconds(previous)} 秒`);
      this.resultStars.innerHTML = starsMarkup(game.stars());
      this.resultStars.hidden = false;
      this.resultMain.textContent = last ? '选择关卡' : '下一关';
      this.resultMain.onclick = () => (last ? this.openLevels() : this.startLevel(i + 1));
      this.resultAlt.textContent = '再来一次';
      this.resultAlt.onclick = () => this.startLevel(i);
    } else {
      const copy = LOSE_COPY[game.loseReason ?? 'basketball-lost'];
      this.resultTitle.textContent = copy.title;
      this.resultDetail.textContent = copy.detail;
      this.resultStars.hidden = true;
      this.resultMain.textContent = '再来一次';
      this.resultMain.onclick = () => this.startLevel(this.levelIndex);
      this.resultAlt.textContent = '选择关卡';
      this.resultAlt.onclick = () => this.openLevels();
    }
    this.result.hidden = false;
  }

  // ---------------------------------------------------------------- 输入

  private bind(): void {
    const stage = this.stage;
    stage.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      if (this.mode !== 'play' || this.drag) return;
      this.drag = { id: e.pointerId, x: e.clientX };
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        // 个别浏览器在指针已失效时会抛错；拿不到捕获也不影响拖动
      }
      stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      this.drag.x = e.clientX;
      // 手指移动多少，最外圈轨道的底部就跟着走多少
      this.steer(dx / (this.renderer.cam.scale * this.level.hoop.ringR));
    });
    const release = (e: PointerEvent): void => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;
      else if (e.key === 'Shift') this.keys.fine = true;
      else if ((e.key === 'r' || e.key === 'R') && this.mode === 'play') this.startLevel(this.levelIndex);
      else if (e.key === 'Escape' && !this.levelsScreen.hidden) this.closeLevels();
      else return;
      this.sound.unlock();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;
      else if (e.key === 'Shift') this.keys.fine = false;
    });
    window.addEventListener('blur', () => {
      this.keys.left = this.keys.right = this.keys.fine = false;
    });

    const press = (id: string, action: () => void): void => {
      $(id).addEventListener('click', () => {
        this.sound.unlock();
        this.sound.click();
        action();
      });
    };
    press('btn-start', () => this.startLevel(this.progress.unlocked));
    press('btn-pick', () => this.openLevels());
    press('btn-levels', () => this.openLevels());
    press('btn-close-levels', () => this.closeLevels());
    press('btn-restart', () => this.startLevel(this.levelIndex));
    this.soundBtn.addEventListener('click', () => {
      this.progress.sound = !this.progress.sound;
      this.sound.setEnabled(this.progress.sound);
      this.soundBtn.setAttribute('aria-pressed', String(this.progress.sound));
      saveProgress(this.progress);
      this.sound.click();
    });
    this.levelsScreen.addEventListener('click', (e) => {
      if (e.target === this.levelsScreen) this.closeLevels();
    });

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
    });
  }

  private steer(delta: number): void {
    if (this.mode !== 'play' || this.game.over) return;
    const max = this.level.maxTilt;
    this.target = Math.max(-max, Math.min(max, this.target + delta));
    this.game.setTarget(this.target);
    if (!this.hint.hidden && !this.hint.classList.contains('is-fading')) {
      this.hint.classList.add('is-fading');
      window.setTimeout(() => {
        if (this.hint.classList.contains('is-fading')) this.hint.hidden = true;
      }, 5200);
    }
  }

  private onResize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.updateView();
  }

  // ---------------------------------------------------------------- 主循环

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const game = this.game;

    if (this.mode === 'title') {
      // 标题页：转盘自己轻轻摆，球在碗里来回滚（不算开局）
      this.demoClock += dt;
      game.world.setRigTarget(deg(7) * Math.sin(this.demoClock * 0.9));
    } else if (this.keys.left !== this.keys.right) {
      const rate = deg(this.keys.fine ? 28 : 85);
      this.steer((this.keys.right ? rate : -rate) * dt);
    }

    // 选关面板盖在对局上面时，对局暂停
    const paused = this.mode === 'play' && !this.levelsScreen.hidden;
    // 篮球进筐的瞬间放慢一下
    if (!paused) this.acc += dt * (now < this.slowUntil ? 0.3 : 1);
    let steps = 0;
    while (this.acc >= TICK && steps < 12) {
      this.prevRig = game.world.rigAngle;
      game.tick();
      this.net.step(game);
      this.react(now);
      this.acc -= TICK;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    this.fx.step(dt);

    const alpha = this.acc / TICK;
    this.renderer.draw({
      game,
      rigAngle: this.prevRig + (game.world.rigAngle - this.prevRig) * alpha,
      alpha,
      net: this.net,
      fx: this.fx,
    });

    if (this.mode === 'play') {
      const text = seconds(game.time);
      if (text !== this.shownTime) {
        this.shownTime = text;
        this.hudTime.textContent = text;
      }
    }
  };

  /** 把这一 tick 里发生的事变成声音和特效 */
  private react(now: number): void {
    const game = this.game;
    const quiet = this.mode === 'title';
    for (const e of game.events) {
      if (e.type === 'impact') {
        if (!quiet) this.sound.impact(e.impact);
        if (e.impact.speed > 2.4 && e.impact.type !== 'ball') {
          this.fx.dust(e.impact.x, e.impact.y, e.impact.speed / 3);
        }
      } else if (e.type === 'score') {
        if (!quiet) this.sound.swish();
      } else if (e.type === 'out') {
        if (!quiet && e.kind === 'volleyball' && !game.over) this.sound.drop();
      } else if (e.type === 'win') {
        const a = game.hoopAngle();
        const d = game.level.hoop.chordDist + 0.1;
        this.fx.confetti(d * Math.sin(a), d * Math.cos(a));
        this.slowUntil = now + 650;
        if (!quiet) this.sound.win();
        if (this.mode === 'play') this.resultTimer = window.setTimeout(() => this.finish(), 1500);
      } else if (e.type === 'lose') {
        if (!quiet) {
          if (e.reason === 'volleyball-scored') this.sound.whistle();
          else this.sound.miss();
        }
        if (this.mode === 'play') this.resultTimer = window.setTimeout(() => this.finish(), 1100);
        else this.showTitle();
      }
    }
  }
}
