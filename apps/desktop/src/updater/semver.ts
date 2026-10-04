// ============================================================
// apps/desktop/src/updater/semver.ts
// 语义化版本比较（纯函数，无依赖）。
//
// 契约来源：ADR D14.2 ——
//   `appOutdated = compareVersions(manifest.version, appVersion) > 0`
//   （语义化版本比较，纯数字段比较；预发布后缀按字符串比较，需人工确认是否够用）
// ADR D20 R12 要求 t6 单测覆盖预发布后缀；本实现按 semver 2.0.0 §11 规则
// 处理预发布标识符（数字标识符 < 字母数字标识符），比"按字符串比较"更严格，
// 属于对 ADR 的**加强**而非偏离（返回值符号与 ADR 语义一致）。
// ============================================================

/** 把 `v1.2.3` / `1.2.3` 拆成 `{ core: number[], pre: string[] }`。非法输入抛错由调用方兜住。 */
function parse(version: string): { core: number[]; pre: string[] } {
  const raw = String(version).trim();
  const stripped = raw.startsWith('v') || raw.startsWith('V') ? raw.slice(1) : raw;
  const plus = stripped.indexOf('+');
  const withoutBuild = plus >= 0 ? stripped.slice(0, plus) : stripped;
  const dash = withoutBuild.indexOf('-');
  const coreStr = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild;
  const preStr = dash >= 0 ? withoutBuild.slice(dash + 1) : '';

  const core = coreStr.split('.').map((seg) => {
    const m = /^(\d+)/.exec(seg.trim());
    return m ? Number(m[1]) : 0;
  });
  const pre = preStr.length > 0 ? preStr.split('.').filter((s) => s.length > 0) : [];
  return { core, pre };
}

function comparePre(a: string[], b: string[]): number {
  // semver 2.0.0 §11：无预发布后缀 > 有预发布后缀
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // 段数少者优先级低
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
      continue;
    }
    if (xNum) return -1; // 数字标识符优先级低于字母数字标识符
    if (yNum) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 比较两个版本号。
 * @returns `a > b` ⇒ 正数；`a < b` ⇒ 负数；相等 ⇒ 0。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa.core[i] ?? 0;
    const y = pb.core[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/** `a` 是否严格高于 `b`。 */
export function isNewer(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}