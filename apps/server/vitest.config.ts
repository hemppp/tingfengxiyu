import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 第二个模式：novel.autowrite 插件的框架单测（纯逻辑，借 server 的 vitest 运行）
    include: ['src/**/*.test.ts', '../plugins/local/novel.autowrite/**/*.test.ts'],
    environment: 'node',
    // 插件挂载涉及动态 import + SQLite 初始化，整体较慢
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // 每个测试文件独立进程：宿主/DB 全局状态不互相污染
    pool: 'forks',
  },
});
