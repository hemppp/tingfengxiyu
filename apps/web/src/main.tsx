import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
// ★ 主题层在主样式之后引入。非默认主题的选择器写作 html[data-theme="..."]，
//   特异性高于 .dark，所以不依赖引入顺序即可稳定覆盖 —— 这里只是双保险。
import './styles/themes.css';
// ★ 水墨UI（shuimo.design）移植层。全部规则限定在 `html[data-theme="shuimo"]`
//   或 `.sm-*` 类名下 —— 不挂该主题时对既有样式零影响。
//   它同时重定义了 76 个 `nm-*` 语义类，所以切到该主题 = 全站换皮（tsx 无需改动）。
import './styles/shuimo.css';
import { registerProjectIdGetter } from './services/api/apiClient';
import { applyStoredTheme } from './stores/themeStore';

// ★ 首屏渲染前同步应用本地主题，否则会先闪一下默认配色再切换
applyStoredTheme();
import { useProjectStore } from './stores';
import { mountWebPlugin } from './plugin/host';
import type { WebPluginModule } from './plugin/types';
import { builtinPanelsPlugin } from './plugin/builtin';

// 注册 projectId getter：apiClient 在每次请求时读取，自动注入 X-Project-Id 头部。
// 后端项目级路由根据此头部初始化对应的项目库（每本书独立 .db 文件）。
registerProjectIdGetter(() => useProjectStore.getState().currentProject?.id);

// ★ 插件挂载前先对齐 Server 端状态（novel-plugin-standard/1.0）：
//   Server 侧被禁用 / 安装门拒绝 / 挂载失败的插件，Web 面不再挂载，
//   避免"面板还在、接口全 404"的半坏状态。Server 不可达时放行全部（保持离线可打开）。
async function fetchServerPluginStates(): Promise<Map<string, string> | null> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return null;
    const data = (await res.json()) as { plugins?: Array<{ id: string; status: string }> };
    return new Map((data.plugins ?? []).map((p) => [p.id, p.status]));
  } catch {
    return null;
  }
}

// ★ 本地插件 Web 面（apps/plugins/local/{id}/web/index.tsx）——
// vite 构建期静态收集（import.meta.glob），AI 创建的插件落盘后自动进入此集合；
// 新增文件需重启 vite dev（或重新构建）后生效。单个失败只禁用该插件。
async function mountAllWebPlugins(): Promise<void> {
  const states = await fetchServerPluginStates();
  // 仅当 Server 明确报告该插件状态非 ok 时拦截；Server 不可达 / 纯 Web 插件（无 Server 面）不拦截
  const blocked = (id: string): boolean => {
    const st = states?.get(id);
    return st !== undefined && st !== 'ok';
  };

  // 内置插件 + 外部插件统一在此登记（构建期清单）
  const staticEntries: Array<{ id: string; load: () => Promise<WebPluginModule> }> = [
    { id: 'novel.builtin-panels', load: async () => builtinPanelsPlugin },
    // 世界观建造师示例插件（面板 + 命令）
    { id: 'novel.worldbuilding', load: () => import('@novel-plugins/worldbuilding/web') },
    // 外部插件在此追加：{ id: 'xxx', load: () => import('@novel-plugins/xxx/web') }
  ];
  for (const entry of staticEntries) {
    if (blocked(entry.id)) {
      console.warn(`[plugins] Web 面跳过 ${entry.id}（Server 端状态: ${states?.get(entry.id)}）`);
      continue;
    }
    await mountWebPlugin(entry.id, entry.load);
  }

  // 本地插件（AI 创建的插件）自动收集挂载（相对本文件：../../../apps/plugins/local/*/web/index.tsx）
  const modules = import.meta.glob('../../../apps/plugins/local/*/web/index.tsx');
  for (const [path, loader] of Object.entries(modules)) {
    try {
      const mod = (await loader()) as WebPluginModule;
      const shortId = path.match(/local\/([^/]+)\/web\/index\.tsx$/)?.[1] ?? 'unknown';
      const id = typeof mod.name === 'string' && mod.name ? mod.name : `local.${shortId}`;
      if (blocked(id)) {
        console.warn(`[plugins] Web 面跳过 ${id}（Server 端状态: ${states?.get(id)}）`);
        continue;
      }
      await mountWebPlugin(id, async () => mod);
      console.debug(`[local-plugins] Web 面已挂载: ${id} (${path})`);
    } catch (err) {
      console.error(`[local-plugins] Web 面挂载失败 (${path}):`, err);
    }
  }
}

void mountAllWebPlugins();

// 初始化数据库——仅在 Node 环境（Electron/SSR）下需要。
// 浏览器 SPA 走 localStorage 桥接（见 services/data/databaseService.ts），
// 无需 sql.js wasm 加载，避免主 bundle 膨胀。
const isBrowser = typeof window !== 'undefined';
if (!isBrowser) {
  void import('@novel/db').then(({ initDatabase }) =>
    initDatabase().catch((err: unknown) => {
      console.error('[NovelMuse] 数据库初始化失败（非致命）:', err);
    }),
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
