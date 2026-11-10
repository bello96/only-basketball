// 生成标题字体的子集：只保留界面里实际用到的字，几十 KB 就够，不必让玩家下载 8MB 的整套字体。
//
// 字体：站酷庆科黄油体（ZCOOL QingKe HuangYou），SIL OFL 1.1 授权，可自由再分发。
// 原始 TTF 在 https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou
//
// 用法：node tools/subset-font.mjs <ZCOOLQingKeHuangYou-Regular.ttf 的路径>
// 界面文案（index.html、src/ 下的源码）有增减之后重新跑一遍即可。
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import subsetFont from 'subset-font';

const source = process.argv[2];
if (!source) {
  console.error('请给出原始 TTF 的路径：node tools/subset-font.mjs <ttf>');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** 去掉注释：注释里的汉字不会显示在界面上，不必收进字体 */
function stripComments(code) {
  return code
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = ['index.html', ...walk('src').filter((f) => /\.(ts|html)$/.test(f))];
const chars = new Set('0123456789.,:!?%+-×、，。！？：（）「」 ');
for (const file of files) {
  for (const ch of stripComments(readFileSync(file, 'utf8'))) {
    if (/[一-鿿]/.test(ch)) chars.add(ch);
  }
}

const text = [...chars].join('');
const subset = await subsetFont(readFileSync(source), text, { targetFormat: 'woff2' });
writeFileSync('src/assets/fonts/huangyou-subset.woff2', subset);
console.log(`收录 ${chars.size} 个字符，输出 ${(subset.length / 1024).toFixed(1)} KB -> src/assets/fonts/huangyou-subset.woff2`);
