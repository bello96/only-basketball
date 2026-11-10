// 让 Node 直接运行本项目的 TypeScript 源码：
// 源码里的相对导入不带扩展名（给 Vite 用的写法），这里在解析失败时补上 .ts。
// 用法：node --import ./tools/register.mjs tools/xxx.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
