# 跨文档对账 + 归属清单 · 复审（round 3 / t22）

| 项 | 值 |
|---|---|
| 被评审 | `docs/reports/web-split-reconciliation.md`（**113 行 / SHA256[:16]=`6BAA605A1A87722E`**） |
| 被评审 | `.workbuddy/split-workbenches/ownership-final.json`（**216 条 / SHA256[:16]=`E31631A94727132B`**） |
| 复审轮次 | round 3（承接 t12 的 R-F1/R-F2/R-F3；核 t21 修复） |
| 权威 | `CAPTAIN-DECISIONS.md`（D1–D24） |
| 方法 | 逐条核 R-F1/R-F2/R-F3 + 用仓库事实复核 + 覆盖/去重复查 |
| **verdict** | **pass**（含 1 条 low 非阻断项） |

## 0. 结论摘要

- **R-F1（medium）✅ 已闭环**：`ownership-final.json` 的 `services/editor/rhythmService.ts` 已由 `manual` → **`shared`**，`evidence` = 「D19-②；契约 §3.3 L120（迁移→shared，@deprecated）」。分布更新为 `kernel 48 / manual 63 / auto 52 / shared 53 = 216`，与顶层 `domainCounts` 一致。
- **R-F2（low）✅ 已闭环**：报告头部权威改 **D1–D24**（L5）；新增 L9「⚠️ 时点与后续更新（t21 回填）」段；§2-② 末尾新增 L44「⚠️ 后续更新（D19-② 覆盖本条）」；§5 补三条回填（L113）。
- **R-F3（low）✅ 已闭环**：清单顶层新增 `authority="CAPTAIN-DECISIONS.md (D1–D24)"`、`snapshotNote`（含「消费前先核对 authority 版本」）、`generatedBy="t11 (t21 rescan)"`、`rescannedAt`。
- 覆盖仍为 **216 ↔ 216**、无重复；抽查归属无新增漂移。
- **仅 1 条 low 非阻断**：报告 §4 L101 的分布仍写旧值（`manual 64 / shared 52`），未随 D19-② 更新（见 R4-F1）。因报告自述为「时点快照」且机器消费的清单本身已正确，**不构成阻断**。

---

## 1. R-F1 / R-F2 / R-F3 逐条复核

| 原 finding | 修复要求 | 现状证据 | 结论 |
|---|---|---|---|
| **R-F1**（medium）rhythmService manual→shared | 改 shared + 复扫同类漂移 | 清单条目 `domain="shared"`、`evidence="D19-②；契约 §3.3 L120（迁移→shared，@deprecated）"`；`domainCounts={kernel:48,auto:52,shared:53,manual:63}` | ✅ 闭环 |
| **R-F2**（low）报告权威 D1–D16 过期 | 改 D1–D24 + §2-② 回填 | L5 `D1–D24`；L9 时点段；L44 D19-② 回填；L113 §5 回填（rhythmService/D19-②、registerChatPanel→registerBuiltinBubble/D21、RightSidebar/D19-①） | ✅ 闭环 |
| **R-F3**（low）清单缺 authority/snapshotNote | 增字段 | `authority`、`snapshotNote`、`generatedBy`、`rescannedAt` 均已加 | ✅ 闭环 |

**t21 声明的「全量复扫」复核**：清单 `evidence` 字段抽查（`rhythmService`、`stores/index.ts`、`layout/{ProjectLayout,PanelSection,FloatingBubbles}`、`outlineNotepadStore`、`chapterLocalCache`、`credentials`、`encryptionService`）均与现行 D/契约一致，未发现新的陈旧项。

---

## 2. 覆盖与去重复查

- `apps/web/src` 实际文件 **216**；清单 `files` **216**；**0 漏 / 0 重**。
- 分布 `kernel 48 / manual 63 / auto 52 / shared 53 = 216`（与 `domainCounts` 一致）。
- ✅ 覆盖完整、无重复。

---

## 3. Findings

### R4-F1（low）· 报告 §4 分布仍为旧值（`manual 64 / shared 52`），未随 D19-② 更新

- **file**: `docs/reports/web-split-reconciliation.md:101`
- **problem**: §4「归属清单」写「**分布**：`kernel 48 / manual 64 / auto 52 / shared 52`」。该值是 **t11 时点**结果；t21 已按 D19-② 把 `rhythmService` 由 manual→shared，清单实际分布为 `kernel 48 / manual 63 / auto 52 / shared 53`。报告 §5 的回填段（L113）列了三项变更，但**未提**分布数字的变化，故报告内部仍留一处与现行清单不符的数字（两处之和均为 216，报告自身不矛盾，但与清单跨产物不一致）。属**快照报告的残留**，不影响被 t3 消费的清单本身。
- **requiredFix**: 将 §4 L101 分布改为 `kernel 48 / manual 63 / auto 52 / shared 53`，或就地加注「分布以现行 `ownership-final.json.domainCounts` 为准（D19-② 后 manual 63 / shared 53）」。

---

## 4. 非阻断观察

1. 报告 §2-①（RightSidebar）与 §2-⑤（契约 §6 行号 L175）等**行号/表述为 t11 时点**，其后 D19-①、t18/t19 已改动设计与契约；报告已在 L9/L113 以「以裁决为准」统括覆盖，**可接受**（快照 + 覆盖段模式）。
2. `snapshotNote` 明确「消费前先核对 authority 版本」，与 R-F3 诉求一致，**表述充分**。

---

## 5. 验收判据对照

| 验收项 | 结果 |
|---|---|
| R-F1 已闭环（rhythmService→shared） | ✅ |
| R-F2 已闭环（权威 D1–D24 + §2-② 回填） | ✅ |
| R-F3 已闭环（authority/snapshotNote） | ✅ |
| 覆盖全部文件、无遗漏、无重复 | ✅（216↔216） |
| 未改被评审文档 | ✅（仅新增本报告） |

**最终 verdict：`pass`** —— t21 三条修复全部落地并经仓库事实复核；唯一残留 R4-F1 为 **low** 级快照数字，不影响 t3 消费的清单，**不阻断**。
