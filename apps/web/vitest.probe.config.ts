// ============================================================
// vitest.probe.config.ts — 临时探针的**逃生舱**配置（t2 / F-1）
//
// 为什么需要它：
//   `vitest.config.ts` 的 `exclude` 刻意排除了 `__scratch__/**` 与 `__scratch_*`，
//   以免一次性探针污染默认收集（见那里的 F-1 注释）。但 vitest 的 CLI 位置参数
//   是**对「已收集文件」的过滤**，被 exclude 掉的探针因此也**无法**用
//   `vitest run <路径>` 显式运行 —— 证伪工作流（拿「修复前」的副本去跑回归用例、
//   证明用例真的会失败）会因此失效。
//
//   ⚠ 适用面**仅限探针命名**：**普通**测试文件的显式路径运行无需本配置
//   （实测 `vitest run src/components/shell/dock/DockShell.smoke.test.tsx`
//   → 17 passed, exit 0）。不要为了「跑单个测试文件」而绕道本配置。
//
// 用法（显式指定本配置 + 探针路径）：
//   pnpm --filter @novel/web exec vitest run \
//     --config vitest.probe.config.ts src/components/shell/__scratch__/x.test.tsx
//
// 本文件**只**放开 `__scratch__` / `__scratch_*`，其余排除项（node_modules、
// dist、e2e 等）一律保留 —— 逃生舱不得顺带把依赖目录里的测试扫进来。
//
// ⚠ 本配置**不是**默认入口：`pnpm test` / CI 走的仍是 `vitest.config.ts`。
//   探针用完必须删除（它是证据，不是交付物）。
// ============================================================

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../plugins/manual/workbench/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../plugins/auto/workbench/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../plugins/shared/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    // ★ 与 vitest.config.ts 的差别**仅**在于：不排除 __scratch__ / __scratch_*。
    exclude: [
      '**/node_modules/**',
      '../plugins/*/workbench/node_modules/**',
      '../plugins/*/node_modules/**',
      '../plugins/shared/*/node_modules/**',
      '**/dist/**',
      '**/.idea/**',
      '**/.git/**',
      '**/.cache/**',
      '**/e2e/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@novel-plugins/ui-graph': path.resolve(__dirname, '../plugins/shared/ui-graph/src'),
      '@novel-plugins/ui-kit': path.resolve(__dirname, '../plugins/shared/ui-kit/src'),
      '@novel-plugins/data-core': path.resolve(__dirname, '../plugins/shared/data-core/src'),
      '@novel-plugins/manual-workbench/web': path.resolve(
        __dirname,
        '../plugins/manual/workbench/web/index.tsx',
      ),
      '@novel-plugins/manual-workbench/stores': path.resolve(
        __dirname,
        '../plugins/manual/workbench/stores/index.ts',
      ),
    },
  },
});