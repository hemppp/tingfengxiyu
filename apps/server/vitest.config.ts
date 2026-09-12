import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // 第二个模式：novel.autowrite 插件的框架单测（纯逻辑，借 server 的 vitest 运行）
    // 注：插件目录下有 node_modules（pnpm hoisted 的副本），通配 `.test.ts` 若不加排除，
    //     会把里面的第三方测试也扫进来（实测跑到了 core 的 install.test.ts），
    //     拖慢甚至卡住整个套件 —— 所以 include 收窄到 server/ 且显式 exclude。
    include: ['src/**/*.test.ts', '../plugins/local/novel.autowrite/server/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/node_modules/**'],
    environment: 'node',
    // 插件挂载涉及动态 import + SQLite 初始化，整体较慢
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // 每个测试文件独立进程：宿主/DB 全局状态不互相污染
    pool: 'forks',
  },
});
