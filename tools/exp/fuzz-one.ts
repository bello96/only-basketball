// 实验：把某一关的拟人扰动第 N 局单独跑出来，看它是怎么输的
// 用法：node --import ./tools/register.mjs tools/exp/fuzz-one.ts <关卡序号> <种子>
import { Game } from '../../src/game/game';
import { LEVELS } from '../../src/game/levels';
import { noisyScript, runScript } from '../lab';
import { SCRIPTS } from '../scripts';

const index = Number(process.argv[2]) - 1;
const seed = Number(process.argv[3]);
runScript(new Game(LEVELS[index], { settle: true, recordImpacts: false }), noisyScript(SCRIPTS[index].solve, seed));
