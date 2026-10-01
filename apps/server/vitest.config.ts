import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // ★ t10（AI 写作模块剥离）：原有第二个 include
    //   `'../plugins/auto/novel.autowrite/server/**/*.test.ts'` 已**删除** ——
    //   novel.autowrite 的实现（含其 10 个框架单测文件 / 184 用例）已随模块移出仓外
    //   （见 .workbuddy/strip-auto-research/MANIFEST.json 与 F:\new1.2-detached\
    //   ai-autowrite-module\），该 glob 现已命中 0 文件。
    //   保留它是「死 include」：vitest 不报错，但会让「server 用例数」的口径失真，
    //   且掩盖「auto 用例已不在本套件」这一事实。装回模块时恢复本行即可
    //   （PLUG-BACK.md 有步骤）。故此处只留 src/**。
    //   注：exclude 里的 `**/node_modules/**` 仍保留 —— 插件目录下的 node_modules
    //   副本仍可能被其它 glob 扫到，且它是通用护栏。
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/node_modules/**'],
    environment: 'node',
    // 插件挂载涉及动态 import + SQLite 初始化，整体较慢
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // 每个测试文件独立进程：宿主/DB 全局状态不互相污染
    pool: 'forks',
  },
});
