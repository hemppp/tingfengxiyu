# NovelMuse 代码审查流程（Code Review Process）

> 配套文档：[STANDARD.md](./STANDARD.md)（评审检查清单）
> 目标：把"质量参差不齐"收敛为"每次合并都经过统一、可复核的门槛"。流程尽量轻，但**门禁不可妥协**。

---

## 1. 角色与职责

| 角色 | 是谁 | 职责 |
|------|------|------|
| **Author（作者）** | PR 提交者 | 保证代码自测通过、CI 绿、PR 描述清晰、对照清单自检 |
| **Reviewer（评审人）** | 至少 1 名（🔴 安全/数据变更需 2 名） | 按 STANDARD 逐项审查，给出 🔴/🟡/💭 结论 |
| **Maintainer（维护者）** | 有 merge 权限者 | 确认所有 🔴 已解决、CI 绿、描述合规后合并 |

- 小改（文档、样式微调、单测补充）可由 1 名 reviewer 通过。
- 涉及**安全、Drizzle schema/迁移、JWT/认证、对外 API 契约**的 PR，**至少 2 名 reviewer**，其中 1 名需为相关模块 owner。

---

## 2. 分支与提交约定

- 主分支：`main`（受保护，禁止直接 push）。
- 功能分支：`feat/<简短描述>`、`fix/<描述>`、`refactor/<描述>`、`chore/<描述>`。
- 提交信息沿用 README 的 Conventional Commits：`feat:` / `fix:` / `docs:` / `style:` / `refactor:` / `test:` / `chore:`。
- 一个 PR **只解决一个问题**：避免"顺手"混入重构、格式化、无关修复——这会拖慢审查、放大风险。

---

## 3. Definition of Ready（PR 提交前自检）

作者开 PR 前确认：

- [ ] 本地 `pnpm -r type-check` 通过
- [ ] 本地 `pnpm -r lint` 通过
- [ ] 相关功能 `pnpm --filter @novel/web test`（或对应包测试）通过
- [ ] 新增/修改的接口已更新 `@novel/shared` 类型与（如有）前端调用
- [ ] Drizzle schema 变更已生成迁移
- [ ] 对照 [STANDARD.md](./STANDARD.md) 自查，已知 🟡 已记录或开 follow-up

---

## 4. Definition of Done（可合并）

- [ ] CI 门禁全绿（type-check + lint + test，见 `.github/workflows/ci.yml`）
- [ ] 所有 🔴 已修复并复验
- [ ] 所有 🟡 已修复，或 reviewer 与作者达成一致并登记 follow-up issue
- [ ] 达到最少批准数（见第 1 节）
- [ ] PR 描述完整（改动目的、测试方式、风险点、截图/录屏如有 UI 变更）

---

## 5. 审查执行步骤（Reviewer）

1. **先读 PR 描述**，搞清楚"要解决什么问题、怎么验证"。
2. **看 diff 全貌**：先理解结构设计，再看细节；不要逐行盲审。
3. **按 STANDARD 逐项勾选**：安全 → 正确性 → API 契约 → 数据层 → 前端 → AI → 测试 → 性能 → 可维护性。
4. **给结论时用统一标记**：
   - `🔴` 必须改（指明文件:行号 + 原因 + 建议）
   - `🟡` 建议改（同样给原因，允许作者说明为何不改）
   - `💭` 可选（命名/注释等）
5. **表扬好代码**：看到对优良模式的延续（Zod 校验、所有权校验、结构化错误），明确点出——正向反馈让标准被自愿遵守。
6. **结尾给总评**：`Request changes` / `Approved` / `Approved with nits`，并说明阻塞项。

> 禁止"LGTM"式无内容通过。即使批准，也应留下 1–2 句你重点核对了什么，便于追溯。

---

## 6. 严重级别处置规则

| 级别 | 合并前 | 复验 |
|------|--------|------|
| 🔴 Blocker | **阻塞合并**，必须修复 | 作者修复后 reviewer 需重新 review 该文件 |
| 🟡 Suggestion | 尽量修；不修须双方确认 + 开 issue | 不强制复验，但 issue 要进看板 |
| 💭 Nit | 可选 | 不强制 |

- 任何 🔴 未解决，Maintainer **不得合并**。
- 作者与 reviewer 对 🔴 判定有分歧：上升给 Maintainer 或模块 owner 仲裁，**不阻塞超过 1 个工作日**。

---

## 7. 评审 SLA（避免 PR 长期挂起）

| 环节 | 目标时限 |
|------|----------|
| 作者提交后 reviewer 首次响应 | ≤ 1 个工作日 |
| 单轮 review 时长 | ≤ 2 个工作日 |
| 小 PR（< 100 行） | 当日完成 |
| 作者回应 review 意见 | ≤ 2 个工作日 |

- 超时未响应可由 Maintainer 重新指派 reviewer。
- 紧急 hotfix 可走"先合并后补 review"，但需在 24h 内补完并登记。

---

## 8. CI 门禁（强制）

`.github/workflows/ci.yml` 在每次 PR（及 push 到 main）时执行：

```
pnpm -r type-check   # TS strict 全量类型检查
pnpm -r lint         # ESLint（server/web）
pnpm -r test         # Vitest（web，未来含 server）
```

- **CI 红 = 禁止合并**，即使 reviewer 已 approve。
- 本地未跑就开 PR 的，reviewer 可退回要求先自测。
- `apps/agents`（Python）暂未纳入 CI；一旦补测试，加入对应 step。

---

## 9. 合并与善后

- 合并方式：功能完整且历史干净的用 **squash merge**（保持 main 线性）；需要保留分支上下文的大型协作可 rebase merge。
- 合并后删除功能分支。
- 由 PR 暴露出的**共性缺陷**（如"多个模块漏了 body 里的 projectId 所有权校验"），由 reviewer 或 maintainer 回流到 [STANDARD.md](./STANDARD.md) 第 1 节，作为团队级警示。

---

## 10. 质量持续改进回路

每 2–4 周由 Maintainer 跑一次轻量回顾：

1. 拉取近期 PR 的 🔴/🟡 统计，找出**高频问题类别**（如"授权校验遗漏"连续出现 3 次）。
2. 对高频问题：要么补进 STANDARD 的"真实缺口示例"，要么用工具/lint 规则自动化拦截（见下）。
3. 评估是否引入**统一根 ESLint 配置 + Prettier**，进一步消除风格类噪音（当前 server/web 各有一份 flat config，无 Prettier，是审查噪音来源之一）。
4. 推动 `apps/server` 与 `apps/agents` 补测试，缩小与 `apps/web` 的覆盖差距。

---

## 11. 争议与升级

-  reviewer 与 author 无法就 🟡 达成一致：记录各自理由，由 Maintainer 拍板，不阻塞合并。
- 涉及架构/跨模块的重大分歧：开一个 design-discussion issue，邀请相关 owner 异步评审，结论写回文档。
- 原则：**阻塞的是风险，不是人**。对事不对人，所有意见落在代码与文档上。

---

## 附：最小可用起点（今天就能做）

如果你现在只想落地 20% 的精力拿到 80% 的效果，按顺序做：

1. ✅ 采用本仓库 `.github/PULL_REQUEST_TEMPLATE.md`（提交即触发自检）。
2. ✅ 启用 `.github/workflows/ci.yml`（type-check + lint + test 门禁）。
3. ✅ 每次 PR 至少 1 名 reviewer，按 STANDARD 的"安全"小节重点看授权。
4. 逐步把 server / agents 的测试补起来。
