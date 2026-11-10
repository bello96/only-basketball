import { App } from './app';

const app = new App();

if (import.meta.env.DEV) {
  // 开发时方便在控制台里查看对局状态
  (window as unknown as { __app: App }).__app = app;
}
