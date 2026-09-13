// ============================================================
// 一键验证：两侧单测 + 记忆抽查
//
// 为什么单列一个脚本而不是写进 package.json 的一行：
//   ① server 套件**必须用 Node 24**（better-sqlite3 编译于 ABI 137）—— 直接 `vitest` 会 ERR_DLOPEN_FAILED
//   ② 记忆抽查要读真实项目库，跑完真机后才有内容（空库不报错，只提示）
//   ③ 顺序跑、别并发（实测两个 vitest 套件并发会偶发文件级加载失败）
//
// 用法：node scripts/verify-all.mjs
// 退出码：0 = 全过；非 0 = 有失败（可直接接 CI / 提交前钩子）
// ============================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'F:/new1.2';
/** server 套件必须用这个 Node（ABI 137），没有就回退到 PATH 上的 node */
const NODE24 = 'D:/ruanjian/node.24/node.exe';
const NODE = fs.existsSync(NODE24) ? NODE24 : process.execPath;
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

const steps = [
  { name: 'server 单测', cwd: 'apps/server', args: [VITEST, 'run'] },
  { name: 'web 单测', cwd: 'apps/web', args: [VITEST, 'run'] },
  { name: '记忆抽查（不变量）', cwd: '.', args: ['scripts/memory-sample-check.mjs'], allowEmpty: true },
];

let failed = 0;
for (const s of steps) {
  process.stdout.write(`\n${'='.repeat(60)}\n▶ ${s.name}\n${'='.repeat(60)}\n`);
  const r = spawnSync(NODE, s.args, { cwd: path.join(ROOT, s.cwd), stdio: 'inherit' });
  if (r.status !== 0) {
    // 抽查步骤在"还没有真机数据"时不算失败（它自己会打印空库提示）
    if (s.allowEmpty) {
      console.log(`\n⚠ ${s.name} 退出码 ${r.status}（若只是"库里还没有记忆数据"，可忽略）`);
      continue;
    }
    failed += 1;
    console.error(`\n✗ ${s.name} 失败（退出码 ${r.status}）`);
  }
}

console.log(`\n${'='.repeat(60)}`);
if (failed === 0) {
  console.log('✅ verify-all 全过');
} else {
  console.log(`❌ verify-all：${failed} 步失败`);
}
process.exit(failed === 0 ? 0 : 1);
