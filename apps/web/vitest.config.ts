import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/dist/',
        '**/build/',
      ],
      thresholds: {
        global: {
          branches: 75,
          functions: 85,
          lines: 80,
          statements: 80,
        },
      },
    },
    // D32④：三层拆分后，manual / auto 模块的单测随模块迁往
    //   apps/plugins/{manual,auto}/workbench/**（t4/t5 落地）。
    //   此处预先纳入 include，使模块内测试在 web 工作区一并执行（当前无匹配 → 空集，无副作用）。
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../plugins/manual/workbench/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../plugins/auto/workbench/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      // shared 包的单测（store 迁移后随实现下沉；D20 基线 14 文件须保持）
      '../plugins/shared/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    exclude: [
      // 必须是 glob（`'node_modules'` 只精确匹配同名路径，排除不了嵌套依赖目录）。
      // 否则 `../plugins/*/workbench/**` 的 include 会扫到 pnpm 在模块下生成的
      // `node_modules/**`（如 @novel/core 自带的 mode/install 测试），造成测试数虚增。
      '**/node_modules/**',
      // 模块根在 web 根之外（`../plugins/...`），`**/node_modules/**` 匹配不到 `../` 前缀，
      // 故显式排除模块内 pnpm 生成的嵌套依赖目录。
      '../plugins/*/workbench/node_modules/**',
      '../plugins/*/node_modules/**',
      '../plugins/shared/*/node_modules/**',
      '**/dist/**',
      '**/.idea/**',
      '**/.git/**',
      '**/.cache/**',
      '**/e2e/**',
      // ★ F-1 修复（t2）：**临时探针不得进入默认收集范围**。
      //   背景：调试 / 证伪用的探针文件曾被放在 `src/components/shell/` 下
      //   （如 `__scratch_*.test.tsx`、`__scratch__/` 目录），而 `src/**` 是
      //   默认 include 树 ⇒ 他人恰在该窗口跑 `pnpm test` 会**连带执行**这些
      //   一次性探针，造成：① 测试数与基线不符、② 探针的**故意失败**断言
      //   把整个套件染红、③ 证伪结论被误读为产品缺陷。
      //   故在此**显式排除**两种约定命名：`__scratch__/` 目录与 `__scratch_*` 文件。
      //   ⚠ 副作用（实测更正，勿凭直觉推断）：vitest 的 CLI 位置参数是**对「已收集
      //   文件」的过滤**，不是对收集范围的覆盖 ⇒ 被排除的探针连 `vitest run <显式
      //   路径>` 也跑不起来（报 `No test files found, exiting with code 1`）。
      //   · **普通**测试文件的显式路径运行**不受影响**（实测 `vitest run
      //     src/components/shell/dock/DockShell.smoke.test.tsx` → 17 passed, exit 0）。
      //   · **探针**必须走逃生舱：`--config vitest.probe.config.ts <探针路径>`
      //     （见 vitest.probe.config.ts；它只放开这两种命名，其余排除项不变）。
      '**/__scratch__/**',
      '**/__scratch_*',
    ],
  },
  resolve: {
    alias: {
      // ⚠️ 同步提醒：@ 别名也在 vite.config.ts 和 tsconfig.json 中定义，修改请保持三处一致
      '@': path.resolve(__dirname, './src'),
      // 三层拆分：共享包直连源码（与 tsconfig/vite 三处一致）
      '@novel-plugins/ui-graph': path.resolve(__dirname, '../plugins/shared/ui-graph/src'),
      '@novel-plugins/ui-kit': path.resolve(__dirname, '../plugins/shared/ui-kit/src'),
      '@novel-plugins/data-core': path.resolve(__dirname, '../plugins/shared/data-core/src'),
      // ★ 剥离实现时清理的悬空别名（原 3 条）：auto-workbench 的 /web、/stores 与包名映射。
      //   目标路径已随实现移出仓库，属惰性腐化点；无消费方经此解析（模块入口走
      //   import.meta.glob，见 src/plugin/moduleEntries.ts）。manual 侧保留。
      '@novel-plugins/manual-workbench/web': path.resolve(__dirname, '../plugins/manual/workbench/web/index.tsx'),
      '@novel-plugins/manual-workbench/stores': path.resolve(__dirname, '../plugins/manual/workbench/stores/index.ts'),
    },
  },
});
