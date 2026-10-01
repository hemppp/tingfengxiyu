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
