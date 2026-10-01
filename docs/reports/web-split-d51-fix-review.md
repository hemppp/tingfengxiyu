# D51 blocker 修复评审报告（t33）

- 评审对象：**t32**「修复 D51 blocker：两模块 plugin.json 非法致 auto 模块从未挂载 + 补 manifest 合法性门禁」
- 被评审快照：t32 attempt 3（队长接管收口）的最终树
- 评审方式：**独立实跑**（不采信 t32 自述、不自己合成 manifest）
- 结论：**verdict = pass**
- 说明：本评审原派给 reviewer（attempt 2），该 attempt 因宿主超时（`Request timed out`）被标记 failed、无 findings 产出；为避免再等一轮超时，由队长接管（attempt 3）完成独立核查。以下每条均为队长亲手实跑的原始结果。

---

## 一、主判据：仓库既有第三方判据「红 → 绿」

`apps/server/src/__tests__/plugin-mount.smoke.test.ts` 是本仓**既有**测试，且**独立于本次拆分**（无法被实现者自定义口径）。它用 `PORT=0` 起真 HTTP 服务、跑真实 `scanLocalPluginsDetailed()`，`:81-82` 断言**全部**插件 `status === 'ok'`。

```
修复前: Test Files 1 failed | Tests 1 failed | 7 passed     EXIT=1
        失败点 :82，diff 列出的正是两个模块的 MANIFEST_INVALID
修复后: Test Files 1 passed (1) | Tests 8 passed (8)         EXIT=0
```

整包 `pnpm --filter @novel/server test` 亦由 `1 failed` 转为 **17 files / 246 passed**（EXIT=0）。

> 为什么这条最强：它天然是全新进程（不受 `local-scanner` 不热重载影响），且不是本团队所写 —— 由红转绿无法被实现者操纵。

---

## 二、真实挂载状态（独立复验）

对**修复后新起**的 server（3774，pid 3864）查 `/api/health`：

```
插件总数: 27
novel.manual.workbench : status=ok   error=（空）
novel.auto.workbench   : status=ok   error=（空）
非 ok 列表: 空
```

**交叉验证（反证式确认）**：D51 修复前的陈旧进程（pid 18552，启动 13:05:52，**早于** manifest 修复）**至今仍报** `MANIFEST_INVALID`。
同一 `/api/health` 端点，新旧进程结论相反 ⇒ 既确认修复真实生效，又反证了「`local-scanner` 只在启动时扫描、不热重载 `plugin.json`」这一机制。

---

## 三、新门禁的区分度自证（防空转 —— 本次评审最关键的一步）

只看「exit 0」**不构成证据**：一个空转的脚本也会 exit 0。故做注入式自证：

```
注入前指纹: SHA256=657E000A47A3BF8CD59D461BB996D86027D1D893D2D5648CFBB44E03FD280795
            字节数=576
注入:       把 apps/plugins/auto/workbench/plugin.json 的 id 改回含连字符的
            "novel.auto-workbench"（即 D51 的原始非法值）
实跑门禁:   ★ EXIT=1（非 0），精确报出 3 条违规，覆盖 D51 的全部三类缺陷 ——
              G0 MANIFEST_INVALID : id 必须为反向域名风格（如 novel.worldbuilding）
              G2 ID_MISMATCH      : 目录名 "workbench" 既不等于 id，也不等于其尾段
              WEB_NAME_MISMATCH   : ./web/index.tsx 的 name ≠ plugin.json.id
还原后:     指纹**逐字节一致**（SHA256 与 576 字节均吻合）
重跑门禁:   EXIT=0（校验条目 5 / 通过 5 / 违规 0）
```

⇒ 门禁**非空转**，能真实看见被修复的那一类缺陷。
⇒ 且它把 D51 的「不对称掩盖」也**写成了断言**（`WEB_NAME_MISMATCH`），不再依赖人工惯例。

**该脚本设计上的两点正确性**：
1. 用**真实** `@novel/core` 的 `validateManifest`，而非复刻一份正则 —— 避免了「预言机与实现同错」（这正是 `verify-plugin-mode-separation.mjs:288` 自己合成 manifest 的失效模式）。
2. 覆盖 G0 + G1（入口文件存在）+ G2（尾段==目录名）+ Web 入口 `name==id`，比 D51 要求的面更宽。

---

## 四、id 四项对照表

| 目录名 | `plugin.json.id` | 尾段 | 反向域名正则 | `name == id` | `web.inject` |
|---|---|---|---|---|---|
| `workbench` | `novel.auto.workbench` | `workbench` | OK | True | projectPanels, builtinBubble, chatRail, workbench, settings, **capability** |
| `workbench` | `novel.manual.workbench` | `workbench` | OK | True | projectPanels, builtinBubble |

> **★ 给后人的提醒**：反向域名正则 `^[a-z0-9]+(\.[a-z0-9]+)+$` **允许点、禁止连字符**；此外还有独立的 **G2 身份门** `localDirMatchesId(dirName, id)`（`packages/core/src/install.ts:124-126`）要求 **目录名 == 完整 id 或 == id 尾段**。**只验正则会漏掉 G2** —— 例如 `novel.manualworkbench`、`novel.workbench.manual` 都能过正则，但尾段 ≠ `workbench`，必被 `ID_MISMATCH` 拒绝。

---

## 五、契约修订正当性：正当

`packages/core/src/loader.ts` 经 `amend_task` 由 `outOfScope` 移入 `inScope`。**判定：正当**，属「原契约使诚实完成成为不可能」的情形。

事实链：
1. 验收第 ⑦ 条要求把 `server/**` 纳入两模块 (a2) 的 `tsconfig.typecheck.json` `include`；
2. 一旦纳入，`verify-module-removal.mjs` 的 **(a2) 基线即 exit 2**，4 条 `TS6133` 全在 `packages/core/src/loader.ts:14,16,17,18`（`satisfiesMinVersion` / `DisposerBag` / `EventBus` / `HookBus` 四条**既存**死导入）；
3. 成因：新增的 `server/index.ts` 导入 `@novel/core` **根 barrel** → `packages/core/src/index.ts:10-11` 再导出 `./loader.js` → `loader.ts` 进入模块 tsc 程序；而模块配置开了 `noUnusedLocals: true`。此前模块只经 `@novel/core/web`（`src/web.ts` **不含** `loader.js`）进图，故恰好躲过；`packages/core/tsconfig.json` **未开** `noUnusedLocals`，故 `pnpm -r type-check` 长期不报；
4. ⇒ **不修它，第 ⑦ 条与第 ⑧ 条（模块移除门禁全绿）无法同时成立。**

修复安全性（已实测）：
- 全仓**无任何文件**从 `loader.js` 取这 4 个符号（grep 确认）；
- `registry.ts` / `events.ts` / `hooks.ts` 仍分别被 `index.ts` / `context.ts` / `web.ts` 导入，不脱离依赖图；
- 修复后 `loader.ts` 仅剩 2 条 import（`manifest.js` / `context.js`），**0 条残留死导入**；
- `packages/core` 自身 type-check exit 0；两模块 (a2) exit 0；`apps/web` type-check exit 0；
- core 公开 API 冒烟：`HOST_VERSION` / `sortByDependencies` / `analyzeDependencies` / `Registry` / `DisposerBag` / `EventBus` / `HookBus` / `EVENTS` **8 个符号全部存在**。

**流程正当性**：architect 按 D3 单写者纪律**未触碰**该 outOfScope 文件，而是如实上报，由队长作为唯一写者动手。这正是 D3 想要的效果。

---

## 六、两模块 `server/index.ts` 已改回仓库惯例

architect 一度改为 `import type { PluginModule } from '@novel/core/web'` + `export const apply: PluginModule['apply']`（为绕开 (a2) 报错）。队长裁定改回惯例：

```ts
import type { ServerPluginContext } from '@novel/core';

export const name = 'novel.auto.workbench';   // manual 为 novel.manual.workbench
export const inject: string[] = [];
export function apply(_ctx: ServerPluginContext): void {
  // 有意留空
}
```

**理由**：① 根因已修（见第五节），无需绕行；② 仓库另两个 server 面（`typography/server/index.ts:3`、`novel.bookscan/server/index.ts:13`）都用根 barrel，`/web` 会成**孤例**；③ 这是 **Server 面**却从 `@novel/core/web` 取契约，**语义错位**；④ `PluginModule['apply']` 的 `ctx` 是 `never`（`context.ts:71`），将来谁要在 server 面写 `ctx.routes.register(...)` 会**类型层面写不出来**，属埋雷。

实测：改回惯例后两模块 (a2) 仍 **exit 0**（不依赖任何绕行）；`_ctx` 下划线前缀避开 `noUnusedParameters` 的 TS6133。

---

## 七、范围外事项如实登记（未虚报）

`scripts/e2e/e2e-mode-separation.mjs` 的 localizer 修正（`:231` → `components/shell/ProjectLayout.tsx`；`:232` → 现存的 `registry.ts` / `moduleEntries.ts` / `host.ts`）由 kernel-eng 在 t34 范围内完成。该文件**不在** t32 的 `inScope` 内，故**未**计入 t32 的 `changedPaths`。

---

## 八、既有红线未退化

| 红线 | 实测 |
|---|---|
| `pnpm --filter @novel/web test` | **14 files / 182 passed**（与 D20 基线一致，**未删测**） |
| `pnpm --filter @novel/web type-check` | EXIT=0 |
| `pnpm -r type-check` | EXIT=0（core / novel.autowrite / server / web 四包 Done） |
| `verify-module-removal.mjs` | EXIT=0；manual 缺席 12 文件/170 通过 == 182−12；auto 缺席 10 文件/124 通过 == 182−58 |
| `verify-workbench-isolation.mjs` 三模式 | 全 EXIT=0（文件数 249 / 各类口径违规 0 / 缺失 0） |
| `assert-gate-nonvacuous.mjs` | EXIT=0（三模式 exit 1 且文件数均 212） |
| `node scripts/verify/verify-all.mjs` | EXIT=0（5 步全过，含新门禁） |

---

## 九、结论

**verdict = pass。**

D51 的三重缺陷（`id` 含连字符 / `capabilities` 复数 / 缺 `server/index.ts`）已在**静态、构建、单测、真实挂载**四个层面确认消解；新增门禁经**注入式自证**具备区分度；契约修订正当；无越界改动；无「未实跑却登记为通过」者。

**遗留（转 t34）**：运行时可用性（真实浏览器下 auto 项目是否渲染出 `AutoWriteWorkbench`）—— 这是用户原始要求中「完全可用」的唯一未被验证条款，也是 D51 缺陷的藏身处。