# 两工作台模块抽取实现 · 评审（round 2 / t30）

| 项 | 值 |
|---|---|
| 被评审 | **t29**（repair round 2）对 t4/t5 抽取实现的修复 |
| 评审范围 | `apps/web/src`、`apps/plugins/{manual,auto,shared}/**`、`scripts/verify/**`（**只读**，未改任何实现代码） |
| 权威 | **D44**（队长裁决）> CAPTAIN-DECISIONS > 契约（第 4 次修订，9 条验收）> 设计（t27 pass） |
| 判定口径 | **D44 第 1 条**：唯一合格证据 =「删除模块目录 → type-check exit 0 + test ≥182 → 还原」 |
| **verdict** | **pass** |

## 0. 结论摘要

t6/t7 认定的**两类 blocker 与两类 high 已全部消解**，且以**端到端可执行事实**（非静态规则匹配）证明：

| 维度 | t6/t7（round 1） | t30（round 2，本轮实测） |
|---|---|---|
| 移除 auto → type-check | **exit 2 / 53 错误** | **exit 0** ✅ |
| 移除 manual → type-check | **exit 2 / 62 错误** | **exit 0** ✅ |
| 移除 auto → build | **exit 1**（ENOENT） | **exit 0**，load-fallback 命中 **0** ✅ |
| 移除 manual → build | **exit 1**（ENOENT） | **exit 0**，load-fallback 命中 **0** ✅ |
| 移除 auto → test | 124（glob 空转） | 124 = 182−58，**非空转守卫** ✅ |
| 移除 manual → test | 170（glob 空转） | 170 = 182−12，**非空转守卫** ✅ |
| 门禁 `export…from` 失明 | **失明**（106 条漏报） | **已修**，注入自证 5/5 抓到 ✅ |
| 断言 E | **空转**（恒跑真实树） | **在真实移除树上执行** ✅ |
| 残留垫片 | **107 个** | **0 个** ✅ |
| kernel 硬编码模块入口 | **2 处**（ENOENT 根因） | **0 处** ✅ |
| shared→auto 边（C2） | **未落地** | **已按依赖反转消解** ✅ |

> **独立复跑声明**：本报告所有数字均为**我自跑**所得，未采信实现者或队长的结论；与队长独立复验结果**逐项吻合**（§8）。

---

## 1. 🔴 并发纪律（本轮实测踩到，须记录）

`verify-module-removal.mjs` 会 `renameSync` 移走模块目录再还原。**并发运行会让后到者落在「模块已移走」窗口内读到错误状态**。我实测踩到：

```
node scripts/verify/verify-module-removal.mjs
→ [移除验证] ✗ 已有另一个进程在运行本脚本（锁文件: .workbuddy\split-workbenches\.vmr.lock）
  持有者信息: {"pid":8636,...}  → EXIT=2
```

**处置（未删锁）**：`Get-Process -Id 8636` → **ALIVE**，`CommandLine` = `scripts/verify/verify-module-removal.mjs`（architect 的串行运行）。等待其结束后再跑。

**期间捕获到一次真实污染**：等待中我跑 `verify-workbench-isolation.mjs`（全量模式），得到
`缺失模块目录: 1 个 ✗ 模块目录不存在: auto: apps/plugins/auto/workbench/web` → **EXIT=1**，
当时 `Test-Path apps/plugins/auto/workbench/web/index.tsx` = **False**（目录正被移走）。
**该 EXIT=1 是并发假象，不是缺陷**；进程清空后串行重跑 → **缺失=0，EXIT=0**。

> ⚠️ **若不做此排查，会把假象误判为真缺陷**（反之，也会把真缺陷掩盖成通过）。
> 本报告 §2 起的全部数字均在「`.vmr.lock` 不存在 且 无 `verify-*` 进程」的守卫下取得。

---

## 2. ✅ 可分离性唯一合格证据（D44-1）：`verify-module-removal.mjs`

```powershell
node scripts/verify/verify-module-removal.mjs     # → EXIT=0
```

原始输出摘要：

```
阶段 0 · 静态终态审计
· apps/web/src 残留垫片数 = 0
· kernel 内模块入口硬编码说明符数 = 0

阶段 1 · 全局基线（两模块俱在）
现存测试文件（树中实测）: 14 个
(a) 基线 type-check exit 0    (b) 基线 build exit 0    (c) 基线 test exit 0；收集 14；通过 182
✓ 基线成立
(a1) 覆盖范围实测：apps/web type-check 图共 999 个文件，其中模块内 0 个 / shared 44 个
(a2) 基线 manual 模块内部 type-check exit 0  ✓
(a2) 基线 auto   模块内部 type-check exit 0  ✓

阶段 2 · 移除 manual（apps/plugins/manual/workbench）
移走前指纹: files=71 bytes=741455
该模块自身测试: 2 文件 / 12 用例（实测）    期望（移除后）: 收集 12 / 通过 170 [=182−12]
(a1) kernel+shared type-check exit 0  ✓   (a2) auto 模块内部 type-check exit 0  ✓
(b) build exit 0；load-fallback/ENOENT 命中 0  ✓
(c) test exit 0；收集文件 12（现存 12）✓；通过 170（期望 170）✓
← 已还原；还原后指纹 files=71 bytes=741455 ✓ 与移走前一致；还原后 type-check exit 0 ✓

阶段 2 · 移除 auto（apps/plugins/auto/workbench）
移走前指纹: files=57 bytes=638122
该模块自身测试: 4 文件 / 58 用例（实测）    期望（移除后）: 收集 10 / 通过 124 [=182−58]
(a1) exit 0 ✓   (a2) manual 模块内部 exit 0 ✓
(b) build exit 0；load-fallback/ENOENT 命中 0  ✓
(c) test exit 0；收集文件 10（现存 10）✓；通过 124（期望 124）✓
← 已还原；还原后指纹 files=57 bytes=638122 ✓ 一致；还原后 type-check exit 0 ✓

✓ 模块移除验证通过
```

**判定：PASS** —— 两方向均满足 D44-1：移除态 type-check exit 0、build exit 0、test 达标且**非空转**、还原指纹逐字节一致。

### 2.1 我独立验证了 (a1) 的必要性

`apps/web/tsconfig.json` 为 `include: ["src"]`，我自跑确认其**确实看不见模块内部**：

```powershell
cd apps/web; tsc --noEmit --listFiles
→ total files: 1097 ; plugins/{auto,manual}/workbench 命中: 0 ; plugins/shared: 44
```

⇒ 单靠 `apps/web` type-check **无法**证明模块内部无悬空引用，**(a2) 是结构性必需**，不是冗余步骤。

我自跑 (a2)：

```powershell
tsc -p apps/plugins/manual/workbench/tsconfig.typecheck.json --noEmit  → EXIT=0
tsc -p apps/plugins/auto/workbench/tsconfig.typecheck.json   --noEmit  → EXIT=0
```

**判定：PASS**。(a2) 配置设计正确：`include: ["web/**/*","stores/**/*"]`、**exclude 测试文件**（避免 `toBeInTheDocument` 既有配置缺口噪声——按队长第 3 条纪律，不据此判 fail）。

---

## 3. ✅ 隔离门禁三模式 + 断言 E（显式 `--with-tests`）

> 按队长第 2 条纪律：**默认模式断言 E 为 `skipped`，不得记为通过**。下表严格区分。

| 命令 | 扫描文件数 | A / A' / B / C / 缺失 | 断言 D | 断言 E | exit |
|---|---|---|---|---|---|
| `verify-workbench-isolation.mjs`（全量，**默认**） | **250** | 0 / 0 / 0 / 0 / **0** | passed | **skipped** | **0** |
| `--without auto`（**默认**） | **202** | 0 / 0 / 0 / 0 / 0 | passed | **skipped** | **0** |
| `--without manual`（**默认**） | **183** | 0 / 0 / 0 / 0 / 0 | passed | **skipped** | **0** |
| `--with-tests`（全量，**实跑**） | 250 | 0 / 0 / 0 / 0 / 0 | passed | **passed** | **0** |
| `--without auto --with-tests` | 202 | 0 / 0 / 0 / 0 / 0 | passed | **passed** | **0** |
| `--without manual --with-tests` | 183 | 0 / 0 / 0 / 0 / 0 | passed | **passed** | **0** |

断言 E 原始输出（`--without auto --with-tests`）：

```
断言 E（基线不退化，WITHOUT=auto 模拟树）: passed — 在**真实移除树**上跑
  （委托 verify-module-removal.mjs --module auto，exit 0）；
  收集文件数 10 == 现存 10（非空转守卫）✓；通过 124 == 期望 124（= 182 − auto 自身 58）；
  还原指纹一致 ✓
```

断言 D 原始输出：

```
passed — 载体 import.meta.glob 收集模式目录 ✓；
staticEntries 内模块入口说明符 0 个（期望 0）；kernel 内模块入口静态 import 0 个（期望 0）
```

**判定：PASS** —— 断言 D 由 t6 的「无法判定」变为**可判定**；断言 E 由 t6-F3 的**空转**变为**在真实移除树上执行**，且带「收集数==现存数」非空转守卫。

---

## 4. ✅ t6/t7 blocker 的消解核验（逐条）

### 4.1 T6-F1（blocker）107 个垫片 → **0**

```
apps/web/src 残留垫片数 = 0        （oracle 阶段 0）
files referencing module dirs: 3   （我自扫：仅注释文件 SettingsPage.tsx / autoBuiltin.ts / moduleEntries.ts）
apps/web/src 的 .ts/.tsx: 187 → 81
```

剩余引用全部是**注释**，非代码边（已逐条查看确认）。
唯一剩余再导出壳：`apps/web/src/hooks/useCurrentProjectId.ts → @novel-plugins/data-core/hooks/useCurrentProjectId`
（**shared 包**，非模块目录；是 D39 冻结导入映射表内的合法过渡壳，**不产生跨域边**）。

**判定：PASS**

### 4.2 T6-F2（blocker）门禁 `export…from` 失明 → **已修**

我**直接抽取**门禁的两条正则做单元级验证（非空转自证之外的独立证据）：

```js
const EXPORT_RE = /(?:^|\n)[^\S\n]*export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g;
```

| 用例 | 结果 |
|---|---|
| T6-F1 原始垫片 `export * from '../../../../plugins/auto/...'` | **PASS 抓到** |
| `export { SkillsBar, QuickPromptsBar } from '...'` | **PASS 抓到** |
| `export type { T } from '@novel-plugins/auto-workbench/web'` | **PASS 抓到** |
| 跨行花括号 `export {\n a,\n b\n} from '...'` | **PASS 抓到** |
| 第 107 条 `export * from '../components/knowledge/characterMerge'` | **PASS 抓到** |
| `import { useChatHistoryStore } from '@/stores/chatHistoryStore'` | **PASS 抓到**（import 家族） |
| **负例** `export default function f(){}` | **PASS 不误报** |
| **负例** `export const x = 1;` | **PASS 不误报** |
| **负例** `export { localA, localB };`（本地再导出，无 from） | **PASS 不误报** |

**9/9 通过**（6 正例全抓 + 3 负例零误报）。另核 `toRepoRel()` 已把逃出扫描根的相对引用折算为**仓库根相对路径**再判域（`verify-workbench-isolation.mjs:440`），消除「判 other → 规则全不触发」的二次失明。

**判定：PASS**

### 4.3 T6-F3（high）断言 E 空转 → **已修**

见 §3：断言 E 现**委托 `verify-module-removal.mjs --module <mod>` 在真实移除树上执行**，
并含两条非空转守卫（「收集数 == 现存数且非 0」「通过数 == 182 − 模块自身用例数」）。
我实测两方向断言 E 均 `passed`，且数字自洽（124 = 182−58、170 = 182−12）。

**判定：PASS**

### 4.4 T6-F4（high）shared→auto 边（设计 §4-C2）→ **已按依赖反转消解**

原边：`data-core/src/data/localUserData.ts:10` `import { useChatHistoryStore } from '@/stores/chatHistoryStore'`（经 kernel 垫片 → auto store）。

现方案（我逐行核验）：

```ts
// localUserData.ts:24-25  —— 契约常量，非 import
const CHAT_HISTORY_KEY = 'novelmuse_chat_histories';
// localUserData.ts:38-39  —— 模块自清注册点
type LocalDataCleaner = (projectId: string | null) => void;
const cleaners = new Set<LocalDataCleaner>();
```

```ts
// auto/workbench/web/index.tsx:28,70 —— 模块**主动注册**自己的内存态清理
import { registerLocalDataCleaner } from '@novel-plugins/data-core';
ctx.effect(() => registerLocalDataCleaner((projectId: string | null) => { ... }));
```

**契约常量一致性核验**（防漂移）：`localUserData.ts:25` 的 `CHAT_HISTORY_KEY = 'novelmuse_chat_histories'`
与 `auto/workbench/stores/chatHistoryStore.ts:29` 的 `STORAGE_KEY = 'novelmuse_chat_histories'` **逐字符相同** ✓。
kernel 垫片 `apps/web/src/stores/chatHistoryStore.ts` **已删除** ✓；`@/stores/chatHistoryStore` 全仓**零消费者** ✓。
auto 缺席 ⇒ 注册表为空 ⇒ 只清 localStorage，无悬空 import、无抛错。

**判定：PASS**（与设计 §4-C2「下沉 shared + 反转依赖」等价，且避免了自证脚本 P5 注入所探测的回归面）。

### 4.5 T7 新发现（round 1 由我提出）：kernel 2 处硬编码模块入口 → **0**

t7 证明「即便垫片全清，`ProjectLayout.tsx:36` / `App.tsx:26` 的 `import('@novel-plugins/{auto,manual}-workbench/web')` 仍会让 vite 在 `load-fallback` ENOENT 硬失败」。

现方案：新增 `apps/web/src/plugin/moduleEntries.ts`，改用 `import.meta.glob` **精确两条路径**：

```ts
const MODULE_ENTRIES = import.meta.glob([
  '../../../apps/plugins/manual/workbench/web/index.tsx',
  '../../../apps/plugins/auto/workbench/web/index.tsx',
]);
export function getModuleEntryLoader(dir) { ... }   // 缺席 → null
export function hasModule(dir) { ... }              // 缺席 → false
export function loadModuleComponent(dir, name) { ... } // 缺席/无导出 → null
```

**该设计的正确性由 §2 的 build 断言直接证明**：移除态 `build exit 0；load-fallback/ENOENT 命中 0`（t7 时为 exit 1）。
我并核验了其注释中记载的**真实陷阱**：glob 模式若写成 `manual/*/web/index.tsx` 会**误命中兄弟插件包** `novel.bookscan`/`novel.autowrite`，导致 `hasModule()` 恒 true（模块缺席检测失效）；精确到 `workbench` 后与门禁 `MODULE_DIRS` 同口径 ✓。

**判定：PASS**

### 4.6 队长补充项：`novel.autowrite/web/chat-wheel.tsx` → 已解（**采用更强方案**）

原为 `import { SkillsBar, QuickPromptsBar } from '@/components/ai/ChatPanel'`（垫片）。队长建议改指 auto 模块公开入口。

实现采用了**更彻底的 D46 方案**：改经**恒在的 shared 包**：

```ts
import { SkillsBar, QuickPromptsBar } from '@novel-plugins/ui-kit';
import { useSkillBarProps } from '@novel-plugins/data-core';
```

理由（源码注释 + 我核验）：改指 auto 公开入口后，**移走 auto 模块仍会 `[vite:load-fallback] ENOENT`**（`novel.autowrite` 是 auto 目录下的**兄弟插件包**，它并不随 auto/workbench 一起消失）；改经 ui-kit（严格叶子）+ data-core（连接层）后，对**任一**模块缺席都免疫。

我并核验 auto 入口**仍保留** `export { ChatPanel, SkillsBar, QuickPromptsBar } from './discuss/ChatPanel';`（`:157`）—— 供模块内/kernel 需要时使用，与 D46 不冲突。

**判定：PASS**（方案优于建议，且未破坏原有能力）

---

## 5. ✅ 非空自证（注入式，5/5）

```powershell
node .workbuddy/split-workbenches/tools/_t29_selfproof.mjs     # → EXIT=0
```

```
[自证] 参照（未注入）: exit=0（期望 0） ✓
[自证] P1 export * from <相对深层>（t6-F2 原始失明面）: exit=1（期望 1） A=1 B=1 ✓ 已抓到
[自证] P2 export { … } from <模块包名深层>: exit=1（期望 1） A=1 B=1 ✓ 已抓到
[自证] P3 export type { … } from <相对深层>（跨行花括号）: exit=1（期望 1） A=1 B=1 ✓ 已抓到
[自证] P4 import 相对深层 → 跨域禁令（K2M）: exit=1（期望 1） A=1 B=1 ✓ 已抓到
[自证] P5 ★ shared→auto 边（§4-C2 回归探测）: exit=1（期望 1） A=1 B=0 规则=S2A✓ ✓ 已抓到
[自证] 撤销后: 探针文件残留=0 门禁 exit=0（期望 0） ✓
✓ 非空自证通过：5/5 条注入均被抓到，且注入面已完整撤销
```

**我独立核验其真实性**（不只看它的自述）：
- 读源码确认**确实写文件注入**：`fs.writeFileSync(target, ...)`（`:99`），探针落点 `apps/web/src/__t29_selfproof.ts` 与 `data-core/src/__t29_selfproof_s2a.ts`（`:22`,`:57`）；
- 确认**有 `try/finally` 撤销**（`:89`,`:124`）且**跑完自检残留**（`:130` `allProbes().filter(p => fs.existsSync(p))`）；
- 我自跑后**独立复查**：`Get-ChildItem -Recurse apps -Include "__t29_selfproof*.ts"` → **无残留** ✓，且门禁复跑 exit 0。

**判定：PASS** —— 该自证是「规则写对了但豁免放行」这类**静态读代码看不出**的漏洞的唯一有效探测手段（其首轮曾抓到 kernel 根未枚举文件判 `other` 致 A/B 双失明、D41 豁免面过宽放过 `/web/**` 深层）。

---

## 6. ✅ 回归基线（未退化）

| 命令 | 结果 | exit |
|---|---|---|
| `pnpm --filter @novel/web type-check` | `tsc --noEmit` 无输出 | **0** |
| `pnpm --filter @novel/web test` | **14 文件 / 182 通过** | **0** |
| `pnpm -r type-check` | core / novel.autowrite / server / web 全 Done | **0** |

与 **D20 基线（14 文件 / 182 用例）** 完全一致，**无删测**。

---

## 7. ✅ 归属矩阵、耦合消解与降级契约（用仓库事实复核）

| 项 | 核验结果 |
|---|---|
| 两模块单包（D1） | `apps/plugins/{manual,auto}/workbench/` 齐备，各含 `web/index.tsx` + `stores/` |
| kernel 组件目录残留 | `components/{editor,knowledge,consistency,foreshadow,notes,outline,series,snapshot,stats,timeline,export}` 下 **0 个 .ts/.tsx**；`components/ai` 仅剩 `primitives/`（UI 原子，非 auto 业务） |
| 降级契约（真实分支，非注释） | `QuickPhraseBubble.tsx:196-197` `const cap = getCapability<…>('ai.quickPhrases'); const aiPhrases = cap ? await cap.generate(...) : extractHeuristicPhrases(...)` ✓<br>`useAutoEntityDetection.ts:29` `return getCapability<AIScanCapability>('ai.scan');` ✓ |
| chatRail 优雅降级 | `ProjectLayout.tsx:367` 模式过滤；`:392` `const RailComponent = pluginChatRail?.Component ?? null`（未注册即不渲染，**无内建兜底**，符合 D32-Q3）✓ |
| 模块→kernel 深层相对逃逸 | **0 条** |
| 第 9 条三项 | ① `ChatPanel.tsx:16` lucide 导入**已无 `X`**（全文 `\bX\b` 计数 **0**）✓ ② `ui-kit/package.json` exports 键为 **`./aiBars`** ✓ ③ `novel.autowrite/tsconfig.json` 已有 `@novel-plugins/ui-kit/*` 映射 ✓ |

---

## 8. 与队长独立复验的交叉核对

| 项 | 队长 | 我（t30 自跑） | 一致 |
|---|---|---|---|
| `verify-module-removal` | exit 0 | **exit 0** | ✓ |
| 残留垫片 / 硬编码说明符 | 0 / 0 | **0 / 0** | ✓ |
| 基线测试 | 14 / 182 | **14 / 182** | ✓ |
| 移除 manual 通过数 | 170 = 182−12 | **170 = 182−12** | ✓ |
| 移除 auto 通过数 | 124 = 182−58 | **124 = 182−58** | ✓ |
| 还原指纹 | 一致 | **一致**（71/741455、57/638122） | ✓ |
| 门禁三模式文件数 | 250 / 202 / 183 | **250 / 202 / 183** | ✓ |
| 门禁三模式 exit | 0（A/A'/B/C/缺失 全 0） | **0**（同） | ✓ |
| `--with-tests` 两方向 | exit 0，断言 E passed | **exit 0，passed** | ✓ |
| 自证 | exit 0，5/5 | **exit 0，5/5** | ✓ |
| `pnpm --filter @novel/web type-check` | exit 0 | **exit 0** | ✓ |
| `pnpm --filter @novel/web test` | 14 / 182 | **14 / 182** | ✓ |
| `pnpm -r type-check` | exit 0 | **exit 0** | ✓ |

**全部吻合。**

---

## 9. 已裁决、不再判 fail 的点（遵循队长第 6 条）

| 项 | 处置 |
|---|---|
| `skillsConfig.ts` 保留为再导出壳 | 队长核准（保持模块内 5 个消费者与指纹不变）—— **不判 fail** |
| shared 扫描根不含 `typography` | 队长核准（既有第三方示例插件、对模块 import 数 0；纳入会引入 7 条范围外断言 C 失败，理由见设计 §6.3）—— **不判 fail** |
| (a2) exclude 测试文件 | `apps/web/tsconfig.json` 的 `types` 未含 `@testing-library/jest-dom` 属**既有配置缺口**，纳入会冒出约 50 条 `TS2339 toBeInTheDocument` 噪声 —— **不判 fail** |
| 断言 C 例外面 6 个文件 | 既有第三方插件（`novel.autowrite` / `novel.bookscan` / `worldbuilding` / `typography`），不在拆分写范围内，门禁**仅计数不判失败** —— 非缺陷 |

---

## 10. 低优先观察（**不阻塞放行**）

| id | severity | 说明 |
|---|---|---|
| T30-O1 | low | `apps/web/src/components/{editor,knowledge,consistency,foreshadow,notes,outline,series,snapshot,stats,timeline,export}/` 及 `services/{ai,misc}/` 现存为**空目录**（0 个 .ts/.tsx，垫片删净后的残余）。不影响 type-check/build/test/gate（均 exit 0），但建议后续清理以反映真实结构。 |
| T30-O2 | low | `novel.autowrite` 位于 `apps/plugins/auto/` 下但**不随 `auto/workbench` 一起消失**；D46 已用「经恒在 shared 包」绕开该陷阱。若未来 `auto/workbench` 与 `novel.autowrite` 需真正独立装卸，建议在设计文档中显式记录这一「同目录兄弟包」语义。 |

---

## 11. 验收判据对照（契约第 4 次修订，9 条）

| # | 判据 | 实测 | 判定 |
|---|---|---|---|
| 1 | 残留垫片 = 0 | **0** | ✅ |
| 2 | kernel 硬编码模块入口 = 0 | **0**；移除态 build 无 load-fallback | ✅ |
| 3 | 门禁 `export…from` 覆盖 | 9/9 正则用例通过 | ✅ |
| 4 | 相对路径域判定 | `toRepoRel` 已落地并生效 | ✅ |
| 5 | 断言 B 加固（解析后落点） | 三模式 B=0；自证 P1–P3 均被抓到 | ✅ |
| 6 | shared 域 + S2A/S2M + 三扫描根 | S2A=0 S2M=0；自证 P5 抓到 | ✅ |
| 7 | 断言 E 在真实移除树执行；断言 D 可判定 | 两方向 E `passed`；D `passed` | ✅ |
| 8 | 非空自证 5/5 | **5/5**，无残留 | ✅ |
| 9 | (a1)+(a2) 拆分 / 死导入 X / `./aiBars` / `ui-kit/*` 映射 | 逐项核验通过 | ✅ |

**附加（D44-1 唯一合格证据）**：`verify-module-removal.mjs` **exit 0**，两方向移除态 type-check 0 / build 0 / test 达标非空转 / 还原指纹一致。

---

## 12. 结论

**verdict = `pass`**

t6/t7 的 **2 个 blocker（T6-F1 垫片、T6-F2 门禁失明）+ 2 个 high（T6-F3 断言 E 空转、T6-F4 shared→auto 边）+ 我 round 1 新发现的「kernel 2 处硬编码模块入口」**已全部消解，且以 **D44-1 端到端可执行事实**为证：

> **移除任一模块目录后，另一模块仍可 type-check（exit 0）、可 build（exit 0，无 load-fallback/ENOENT）、可过测（170/124，非空转），还原指纹逐字节一致。**

无残留 blocker；§10 两项 low 观察不阻塞放行。**未修改任何被评审的实现代码**（§13 哈希自证）。

---

## 13. 未修改被评审代码（哈希自证）

对 `apps/web/src`、`apps/plugins/{manual,auto}/workbench`、`apps/plugins/shared`、`scripts/verify`（排除 `node_modules`）
逐文件 SHA256 后做聚合哈希，在本评审会话内**两次取样比对**：

| 时点 | 文件数 | 聚合 SHA256 |
|---|---|---|
| 评审开始 | 288 | `9844D8D4C2A6E0824EFF6065C67385BE8D89152A3560431B86ADF7CFBD024233` |
| 评审结束 | 288 | `9844D8D4C2A6E0824EFF6065C67385BE8D89152A3560431B86ADF7CFBD024233` |

**⇒ 完全一致：本次评审零改动**（所有移除模拟均由 `verify-module-removal.mjs` 的 `try/finally` 自动还原；
自证探针 `__t29_selfproof*.ts` 已确认零残留）。
本任务产出**仅** `docs/reports/web-split-implementation-review-r2.md`。