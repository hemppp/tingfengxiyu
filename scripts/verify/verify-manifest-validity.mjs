#!/usr/bin/env node
/**
 * scripts/verify/verify-manifest-validity.mjs
 *
 * ★ t32 / 验收第 ⑤ 条：**manifest 合法性门禁**（补 D51 暴露的验收集盲区）。
 *
 * ── 为什么需要它（D51 的教训）──────────────────────────────────────────
 * 第 21 轮队长独立运行时复验发现：两个大模块的 `plugin.json` **非法**，
 * 导致 `/api/health` 报 `status=error` ⇒ kernel 的 `blocked(id)` 为真
 * ⇒ **auto 模块从未挂载**、auto 项目永久卡在 `Loading...`。
 *
 * 而当时**全部 10 条验收命令都是绿的**。原因：
 *   · `verify-workbench-isolation.mjs` —— 纯静态 import 扫描，全文不含
 *     `plugin.json` / `package.json` / `novelMuse` / `health` 任一字符串；
 *   · `verify-module-removal.mjs` —— 只验「移走目录后 type-check/build/单测」，不读 manifest；
 *   · `verify-plugin-mode-separation.mjs:288` —— **自己合成** manifest
 *     （`fs.writeFileSync`）后再起临时 server ⇒ **真实 manifest 的非法性它永远看不见**。
 * ⇒「manifest 合法性」这一整类缺陷在验收集里**零覆盖**。
 *
 * ── 本脚本的关键设计：绝不自己合成 manifest ──────────────────────────
 * 与上面那个失效模式相反，本脚本**只读取真实存在的 `plugin.json`**，
 * 并用**真实** `@novel/core` 的 `validateManifest` / `pluginManifestSchema`
 * 做校验（不是复刻一份正则 —— 复刻会随契约漂移，正是「预言机与实现同错」的温床）。
 *
 * ── 判定项（每条都对应 D51 的一个真实缺陷）────────────────────────────
 *  1. **G0 Manifest 门**：`validateManifest(raw)` 必须通过。直接覆盖
 *     「id 含连字符」（`^[a-z0-9]+(\.[a-z0-9]+)+$`）与
 *     「`web.inject` 含非法枚举值」（`capabilities` → 应为 `capability`）两类。
 *  2. **G1 结构门（serverEntry 真实存在）**：`serverEntry`（缺省 `./server/index.ts`）
 *     指向的文件必须 `existsSync` —— 直接覆盖「两模块均无 server/index.ts」。
 *     同时校验 `webEntry` 存在与路径安全（无绝对路径 / 无 `..` 穿越）。
 *  3. **G2 身份门（尾段 == 目录名）**：用真实 `localDirMatchesId(dirName, id)`。
 *     这是 G2 的**静态前置镜像** —— 让「id 尾段不是 workbench」在静态层即暴露。
 *  4. **Web 入口 `name` == `plugin.json.id`**（本仓惯例，也是 D51「不对称掩盖」的
 *     结构性消除）：kernel `main.tsx:91` 取 `mod.name` 作注册 id，
 *     `blocked(id)` 用 `/api/health` 的 `Map(id → status)` 判定。
 *     二者**逐字相同**时，任一 manifest 出问题**两个模块会同时暴露**，
 *     不再有 D51 那种「manual 因 name ≠ id 而侥幸存活」的单侧掩盖。
 *
 * ── 可分离性（模块移除态下仍可跑）──────────────────────────────────
 * 扫描「**真实存在**的 plugin.json」。模块目录被移走 ⇒ 其 plugin.json 不存在
 * ⇒ 自然不在校验集合内，**跳过而非报错**。故本脚本在 `--without <mod>` 态下仍 exit 0。
 *
 * ── ⚠ 与「移除门禁」的并发纪律（两次实测假象的护栏）────────────────
 * 本脚本**只读文件**，与任何服务都不冲突，可随时运行。
 * 但同一仓里的 `scripts/verify/verify-module-removal.mjs` 会 `fs.renameSync`
 * **移走模块目录**，此时若**有任何进程持有这些目录的句柄**，Windows 会拒绝 rename：
 *
 *   · **vite dev**（`apps/web/tailwind.config.js` 的 content 含 `'../plugins/<star><star>/web/<star><star>'`
 *     ⇒ 文件监视器持有 `apps/plugins/<mode>/<pkg>/web` 及其**祖先目录**的句柄）
 *   · **server / tsx watch**（持有 `apps/plugins/<mode>/<pkg>/web` 等）
 *   · 任何在模块目录上跑着的编辑器索引 / 杀软扫描
 *
 * 实测症状：`renameSync` 抛 `EPERM: operation not permitted`（源目录侧，与目标无关）。
 * **已发生过两次**由「并发服务持句柄」造成的假象（前有 `.vmr.lock` 三方假阴性）。
 * ⇒ **跑移除门禁前，先确认无 vite dev / 无 server / 无 e2e 在跑**；
 *   凡见异常**先查锁与服务**，再判缺陷。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────
 *   node scripts/verify/verify-manifest-validity.mjs            # 全量
 *   node scripts/verify/verify-manifest-validity.mjs --verbose  # 逐条打印
 *   node scripts/verify/verify-manifest-validity.mjs --help
 *
 * 退出码：0 = 全部真实 manifest 合法；1 = 有违规；2 = 参数错误 / 无法加载真实契约。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`用法: node scripts/verify/verify-manifest-validity.mjs [--verbose]

用**真实** @novel/core 契约校验全部真实存在的 plugin.json：
  · G0 Manifest 门（validateManifest：id 反向域名风格、web.inject 枚举合法…）
  · G1 结构门（serverEntry/webEntry 指向的文件真实存在、路径安全）
  · G2 身份门（localDirMatchesId：id 尾段 == 目录名）
  · Web 入口 export const name == plugin.json.id（kernel blocked() 对称性）

退出码: 0 = 全部合法; 1 = 有违规; 2 = 参数错误 / 无法加载真实契约`);
  process.exit(0);
}

/* ================================================================
 * 第一段：本进程必须能拿到**真实**契约。
 * @novel/core 的 package.json 把 "." 指向 ./src/index.ts（无 dist），
 * 其内部用 `.js` 后缀 import 同目录 .ts（如 './mode.js'），裸 node 解析不了，
 * 故用 tsx 加载。--import tsx 使本文件本身也能被 tsx 接管。
 * 若已在 tsx 下运行（环境变量标记），则直接执行主逻辑。
 * ================================================================ */
const TSX_FLAG = 'T32_MANIFEST_GATE_UNDER_TSX';

async function main() {
  // 真实契约：从**源码入口**导入（与 apps/server 运行时同一份实现）
  // ★ Windows 必须用 pathToFileURL —— 裸拼 `file://F:/…` 会得到协议 'f:' 而被 ESM 拒绝
  const CORE = path.join(ROOT, 'packages', 'core', 'src', 'index.ts');
  let core;
  try {
    core = await import(pathToFileURL(CORE).href);
  } catch (err) {
    console.error(`✗ 无法加载真实契约 @novel/core（${CORE}）`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    console.error('  提示：本脚本需在 tsx 下运行（会自动重入）。');
    process.exit(2);
  }
  const { validateManifest, localDirMatchesId, WEB_SERVICES } = core;
  if (typeof validateManifest !== 'function' || typeof localDirMatchesId !== 'function') {
    console.error('✗ 真实契约缺少 validateManifest / localDirMatchesId（契约漂移？）');
    process.exit(2);
  }
  // 防「契约静默变空」：枚举白名单必须非空，否则 web.inject 校验会失去区分度
  if (!Array.isArray(WEB_SERVICES) || WEB_SERVICES.length === 0) {
    console.error('✗ 真实契约的 WEB_SERVICES 为空 —— 枚举校验将失去区分度');
    process.exit(2);
  }

  console.log('='.repeat(68));
  console.log('manifest 合法性门禁（真实 @novel/core 契约）');
  console.log('='.repeat(68));
  console.log(`契约来源: packages/core/src/index.ts`);
  console.log(`WEB_SERVICES 白名单: ${WEB_SERVICES.length} 项`);

  /* ---------------- 收集全部真实存在的 plugin.json ---------------- */
  const PLUGINS_ROOT = path.join(ROOT, 'apps', 'plugins');
  const MODE_DIRS = ['manual', 'auto', 'shared', 'local'];

  /** 递归找 plugin.json（跳过 node_modules / dist） */
  function findManifests(dir, out = []) {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) findManifests(p, out);
      else if (e.name === 'plugin.json') out.push(p);
    }
    return out;
  }

  const manifestPaths = findManifests(PLUGINS_ROOT).sort();
  console.log(`\n扫描根: apps/plugins/`);
  console.log(`真实存在的 plugin.json: ${manifestPaths.length} 个`);

  /* ---------------- 逐条校验 ---------------- */
  const violations = [];
  const rows = [];
  // ★ t10：记录「web 面已剥离 ⇒ 跳过 webEntry 检查」的插件（打印 + 计数，不静默）。
  const webEntryExempts = [];

  /** 提取 web 入口的 `export const name = '…'`（静态文本；与门禁同源的保守做法） */
  function readWebExportName(webEntryAbs) {
    let src;
    try {
      src = fs.readFileSync(webEntryAbs, 'utf8');
    } catch {
      return { name: null, reason: '入口文件不可读' };
    }
    const m = src.match(/^\s*export\s+const\s+name\s*=\s*(['"])(.*?)\1/m);
    return m ? { name: m[2], reason: null } : { name: null, reason: '未找到 export const name' };
  }

  for (const abs of manifestPaths) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const dir = path.dirname(abs);
    const dirName = path.basename(dir);
    const parentDirName = path.basename(path.dirname(dir));
    const issues = [];

    // ---- 读取 JSON ----
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      issues.push(`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
      violations.push({ rel, issue: issues[0] });
      rows.push({ rel, id: '(解析失败)', ok: false });
      continue;
    }
    const id = typeof raw.id === 'string' ? raw.id : '(缺失)';

    // ---- ① G0 Manifest 门：真实 validateManifest ----
    let manifest = null;
    try {
      manifest = validateManifest(raw);
    } catch (err) {
      issues.push(`G0 MANIFEST_INVALID: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ---- ② G1 结构门：serverEntry / webEntry 真实存在 + 路径安全 ----
    const serverEntry = manifest?.serverEntry ?? raw.serverEntry ?? './server/index.ts';
    const webEntry = manifest?.webEntry ?? raw.webEntry ?? './web/index.tsx';
    // ★ t10（AI 写作模块剥离）：按**插件包**判定「Web 面是否在场」——
    //   谓词 = `<pluginDir>/web` 目录存在性。这与全仓规范判据对齐（MODULE_DIRS、
    //   moduleEntries.ts 的 ENTRY_SUFFIX/hasModule 都以 `web/` 为源），而不是
    //   旧的 `<pluginDir>` 目录存在性（骨架仍保留 server/index.ts，故那种判据会漏判）。
    //   ⇒ web 面确已移走的插件（如 auto 下两个骨架包）**跳过 webEntry 的 ENTRY_MISSING**，
    //     但 serverEntry 检查、以及所有其它 manifest 检查**原样执行**。
    //   ★ 这不是「webEntry 不检查了」：对任何 `web/` 目录**存在**的插件，webEntry 指向的
    //     文件**必须存在**，否则仍报 ENTRY_MISSING（见下方 existsSync 分支）。
    const pluginWebDir = path.join(dir, 'web');
    // ★ 负向控制开关（仅测试用）：VERIFY_NO_WEB_EXEMPT=1 时**禁用**本豁免，
    //   用于证明「豁免确实是让两个骨架通过的**唯一**原因」（禁用后它们必须重新
    //   报 ENTRY_MISSING），即豁免是**有承载的**、而非把 webEntry 检查变成永真。
    //   机制：把「web 面缺席」强判为 false ⇒ 走正常存在性检查 ⇒ 缺失即 ENTRY_MISSING。
    const exemptEnabled = process.env.VERIFY_NO_WEB_EXEMPT !== '1';
    const webFaceAbsent = exemptEnabled && !fs.existsSync(pluginWebDir);
    const webEntryExempt = { skipped: false, detail: '' };
    for (const [label, entry] of [['serverEntry', serverEntry], ['webEntry', webEntry]]) {
      if (typeof entry !== 'string' || !entry.trim()) {
        issues.push(`G1 ENTRY_INVALID: ${label} 为空`);
        continue;
      }
      const norm = entry.replace(/\\/g, '/');
      if (path.isAbsolute(entry) || norm.split('/').includes('..')) {
        issues.push(`G1 ENTRY_UNSAFE: ${label} 非插件目录内相对路径（${entry}）`);
        continue;
      }
      const abs2 = path.resolve(dir, norm);
      if (!fs.existsSync(abs2)) {
        // 受支持缺席：仅当该插件的 web/ 面确已移走时，才豁免 webEntry 的存在性检查。
        if (label === 'webEntry' && webFaceAbsent) {
          webEntryExempt.skipped = true;
          webEntryExempt.detail = `${id} (web 面不在场: ./web) ⇒ 跳过 webEntry 检查`;
          continue;
        }
        issues.push(`G1 ENTRY_MISSING: ${label} 指向的文件不存在（${entry}）`);
      }
    }
    if (webEntryExempt.skipped) {
      webEntryExempts.push(webEntryExempt.detail);
    }

    // ---- ③ G2 身份门：真实 localDirMatchesId ----
    if (!localDirMatchesId(dirName, id)) {
      issues.push(
        `G2 ID_MISMATCH: 目录名 "${dirName}" 既不等于 id "${id}"，也不等于其尾段` +
          ` "${String(id).split('.').pop()}"（localDirMatchesId 拒绝）`,
      );
    }

    // ---- ④ 模式门 G2.5（目录推导 vs manifest.modes）----
    const modeFromDir = parentDirName === 'local' ? 'shared' : parentDirName;
    if (MODE_DIRS.includes(parentDirName) && Array.isArray(manifest?.modes)) {
      const declared = manifest.modes;
      if (declared.length > 0 && !declared.includes(modeFromDir)) {
        issues.push(`G2.5 MODE_MISMATCH: 目录推导 mode=${modeFromDir}，manifest.modes=[${declared.join(', ')}]`);
      }
    }

    // ---- ⑤ Web 入口 name == plugin.json.id（D51 对称性）----
    const webAbs = path.resolve(dir, webEntry.replace(/\\/g, '/'));
    if (fs.existsSync(webAbs)) {
      const { name: webName, reason } = readWebExportName(webAbs);
      if (reason) {
        // 模块目录（有 workbench 语义）必须导出 name；其它插件缺 name 仅提示
        issues.push(`WEB_NAME_MISSING: ${webEntry} ${reason}`);
      } else if (webName !== id) {
        issues.push(
          `WEB_NAME_MISMATCH: ${webEntry} 的 export const name="${webName}" ≠ plugin.json.id="${id}"` +
            `（kernel main.tsx 取 mod.name 作注册 id，二者不一致会让 blocked() 不对称 —— D51 的成因）`,
        );
      }
    }

    const ok = issues.length === 0;
    for (const issue of issues) violations.push({ rel, issue });
    rows.push({ rel, id, ok });

    if (VERBOSE || !ok) {
      console.log(`\n── ${rel}`);
      console.log(`   id="${id}"  目录名="${dirName}"  父目录="${parentDirName}"`);
      if (ok) console.log('   ✓ 全部通过');
      else for (const i of issues) console.log(`   ✗ ${i}`);
    }
  }

  /* ---------------- 汇总 ---------------- */
  console.log(`\n${'='.repeat(68)}`);
  console.log('汇总');
  console.log('='.repeat(68));
  const okCount = rows.filter((r) => r.ok).length;
  console.log(`校验条目: ${rows.length}  通过: ${okCount}  违规: ${violations.length}`);

  // 关键插件在场性：两模块目录若存在，其 manifest 必须被校验到（防空扫）
  for (const mod of ['manual', 'auto']) {
    const modDir = path.join(PLUGINS_ROOT, mod, 'workbench');
    if (!fs.existsSync(modDir)) {
      console.log(`· 模块 ${mod}/workbench **不在场**（已移除态）⇒ 跳过，不计违规（可分离性）`);
      continue;
    }
    const mf = path.join(modDir, 'plugin.json');
    if (!fs.existsSync(mf)) {
      violations.push({ rel: `apps/plugins/${mod}/workbench/plugin.json`, issue: '模块在场但缺 plugin.json' });
      console.log(`✗ 模块 ${mod}/workbench 在场却缺 plugin.json`);
      continue;
    }
    const row = rows.find((r) => r.rel.endsWith(`plugins/${mod}/workbench/plugin.json`));
    console.log(`· 模块 ${mod}/workbench 在场 ⇒ 已校验（${row?.ok ? '✓ 合法' : '✗ 见上'}）`);
  }

  // ★ t10：受支持缺席（web 面已剥离）单列并计数 —— 不静默、也不计违规。
  if (webEntryExempts.length > 0) {
    console.log(`\n受支持缺席（web 面已剥离，跳过 webEntry 检查，不计违规）: ${webEntryExempts.length} 个`);
    for (const x of webEntryExempts) console.log(`  · ${x}`);
  }

  const allOk = violations.length === 0;
  if (!allOk) {
    console.log(`\n✗ manifest 合法性门禁失败（${violations.length} 条）：`);
    for (const v of violations) console.log(`   ${v.rel}\n     ${v.issue}`);
  } else {
    console.log(
      `\n✓ manifest 合法性门禁通过：${rows.length} 个真实 plugin.json 全部通过` +
        ` G0（真实 validateManifest）/ G1（入口文件存在）/ G2（id 尾段==目录名）` +
        ` / Web 入口 name==id。`,
    );
  }
  process.exit(allOk ? 0 : 1);
}

/* ---------------- 自举：确保在 tsx 下运行 ---------------- */
if (process.env[TSX_FLAG] === '1') {
  await main();
} else {
  /**
   * 裸 node 直接跑：用 tsx 重入自身（--import 让 tsx 接管后续 .ts 解析）。
   *
   * ★ Windows 坑（实测踩过）：`--import` 的值若写成**裸盘符绝对路径**
   *   （`F:/…/tsx/dist/loader.mjs`），node 会把它当 URL 解析、得到协议 `f:`
   *   而抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。故必须用 `pathToFileURL(...).href`
   *   转成合法的 `file:///F:/…` URL。
   */
  const tsxLoader = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  if (!fs.existsSync(tsxLoader)) {
    console.error(`✗ 未找到 tsx（${tsxLoader}）—— 无法加载真实 @novel/core 契约`);
    process.exit(2);
  }
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(tsxLoader).href, fileURLToPath(import.meta.url), ...argv],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, [TSX_FLAG]: '1' } },
  );
  if (r.error) {
    console.error(`✗ 重入失败: ${r.error.message}`);
    process.exit(2);
  }
  process.exit(r.status ?? 2);
}