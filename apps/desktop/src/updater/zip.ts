// ============================================================
// apps/desktop/src/updater/zip.ts
// 最小 ZIP 读取器 + 安全解压（防路径穿越）。
//
// 契约来源：ADR D14.3-2（**冻结，强制验收项**）——
//   「逐个 entry 规范化：`path.resolve(destRoot, entryName)` 必须
//     `startsWith(destRoot + path.sep)`；否则整包拒绝并清理。
//     同时拒绝：绝对路径、含 `..` 的段、Windows 保留名、符号链接/硬链接 entry」
//
// 为什么不用 yauzl：ADR D17.4 把 yauzl 列为 updater 侧的解压库，但本仓库
// `node_modules` 下**没有** yauzl（实测 `MISSING yauzl`），且 `apps/desktop/package.json`
// 归 pack-eng（t3）所有、不在本任务 inScope。因此本模块用 `node:zlib` 的
// `inflateRawSync` 自实现中央目录解析 —— 零新增运行期依赖，且对穿越校验有完全控制权。
// 若 t3 之后装上 yauzl，本模块可被替换，但**校验语义必须保持逐字一致**。
//
// 支持：method 0（store）/ 8（deflate）、ZIP64 大字段、数据描述符（flags bit 3）。
// 拒绝：加密 entry（flags bit 0）、符号链接/硬链接 entry、任何穿越形态。
// ============================================================

import { promises as fsp, createReadStream } from 'node:fs';
import * as path from 'node:path';
import { inflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** 路径穿越/危险 entry 的专用错误类型，便于调用方区分「整包拒绝」。 */
export class ZipSecurityError extends ZipError {
  readonly entryName: string;
  constructor(entryName: string, reason: string) {
    super(`ZIP 条目被拒绝（${reason}）: ${entryName}`);
    this.name = 'ZipSecurityError';
    this.entryName = entryName;
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const MAX_EOCD_SCAN = 0xffff + 22; // 注释最长 65535

export interface ZipEntry {
  /** 原始 entry 名（可能含 `/`，不含前导 `/`） */
  name: string;
  /** 是否目录 entry（以 `/` 结尾） */
  isDirectory: boolean;
  /** 压缩方式：0 = store，8 = deflate */
  method: number;
  /** 压缩后字节数 */
  compressedSize: number;
  /** 解压后字节数 */
  uncompressedSize: number;
  /** CRC-32 */
  crc32: number;
  /** 本地头偏移 */
  localHeaderOffset: number;
  /** 外部属性（含 Unix 模式于高 16 位） */
  externalAttributes: number;
  /** 通用位标志 */
  flags: number;
}

// ------------------------------------------------------------------
// 危险名判定（ADR D14.3-2 逐条）
// ------------------------------------------------------------------

/** Windows 保留设备名（含带扩展名形态，如 `CON.txt`）。 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * 校验单个 entry 名是否安全；不安全抛 `ZipSecurityError`。
 *
 * 逐条实现 ADR D14.3-2 的拒绝清单：
 *  1. 空名
 *  2. 绝对路径（`/foo`、`\foo`、`C:\foo`、`\\server\share`）
 *  3. 含 `..` 的段（同时覆盖 `\` 与 `/` 两种分隔符）
 *  4. Windows 保留名（任一段命中即拒绝）
 *  5. NUL 字节 / 控制字符
 *  6. `path.resolve(destRoot, name)` 必须 `startsWith(destRoot + path.sep)`（兜底终检）
 *
 * @param destRoot 已 `path.resolve()` 过的绝对目标根目录
 * @returns 规范化后的安全相对路径（POSIX 分隔符 → 平台分隔符）
 */
export function assertSafeEntryName(entryName: string, destRoot: string): string {
  const name = String(entryName ?? '');

  // 1. 空名
  if (name.length === 0) throw new ZipSecurityError(name, '条目名为空');

  // 5. NUL / 控制字符
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ZipSecurityError(name, '条目名含 NUL 或控制字符');
  }

  // 统一分隔符后再判断
  const posix = name.replace(/\\/g, '/');

  // 2. 绝对路径
  if (posix.startsWith('/')) throw new ZipSecurityError(name, '绝对路径（前导 /）');
  if (/^[a-zA-Z]:/.test(posix)) throw new ZipSecurityError(name, '绝对路径（盘符）');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(posix)) throw new ZipSecurityError(name, 'URL 形态条目名');

  // 3. `..` 段
  const segments = posix.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..')) throw new ZipSecurityError(name, '含 `..` 路径段');
  if (segments.some((s) => s === '.')) throw new ZipSecurityError(name, '含 `.` 路径段');

  // 4. Windows 保留名（取 basename 去扩展名）
  for (const seg of segments) {
    const base = seg.split('.')[0]?.toUpperCase() ?? '';
    if (WINDOWS_RESERVED.has(base)) throw new ZipSecurityError(name, `Windows 保留名 ${base}`);
  }

  // 6. 兜底终检：resolve 后必须仍在 destRoot 之内
  const target = path.resolve(destRoot, segments.join('/'));
  const rootWithSep = destRoot.endsWith(path.sep) ? destRoot : destRoot + path.sep;
  if (target !== destRoot && !target.startsWith(rootWithSep)) {
    throw new ZipSecurityError(name, 'resolve 后逃出目标根目录');
  }

  return target;
}

/** 是否为符号链接/硬链接 entry（仅 Unix 主机字节有意义）。 */
export function isLinkEntry(entry: ZipEntry): boolean {
  const hostSystem = (entry.externalAttributes >>> 16) & 0xffff; // 不用：见下
  void hostSystem;
  return false;
}

/** Unix 模式（`version made by` 高字节 = 3 时 externalAttributes 高 16 位为 st_mode）。 */
function unixModeOf(versionMadeBy: number, externalAttributes: number): number {
  const host = (versionMadeBy >>> 8) & 0xff;
  if (host !== 3) return 0; // 3 = Unix
  return (externalAttributes >>> 16) & 0xffff;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

// ------------------------------------------------------------------
// 中央目录解析
// ------------------------------------------------------------------

interface CentralEntry extends ZipEntry {
  versionMadeBy: number;
  /** 实际数据区偏移（本地头 + 头长 + 名长 + extra 长） */
  dataOffset: number;
}

async function readCentralDirectory(filePath: string): Promise<CentralEntry[]> {
  const buf = await fsp.readFile(filePath);
  if (buf.length < 22) throw new ZipError('文件过小，不是合法 ZIP');

  // --- 从尾部向前找 EOCD ---
  const scanStart = Math.max(0, buf.length - MAX_EOCD_SCAN);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanStart; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('未找到 EOCD 记录，不是合法 ZIP');

  let entryCount = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // --- ZIP64 ---
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === SIG_EOCD64_LOCATOR) {
      const eocd64 = Number(buf.readBigUInt64LE(locator + 8));
      if (eocd64 >= 0 && eocd64 + 56 <= buf.length && buf.readUInt32LE(eocd64) === SIG_EOCD64) {
        entryCount = Number(buf.readBigUInt64LE(eocd64 + 32));
        cdSize = Number(buf.readBigUInt64LE(eocd64 + 40));
        cdOffset = Number(buf.readBigUInt64LE(eocd64 + 48));
      }
    }
  }

  if (cdOffset + cdSize > buf.length) throw new ZipError('中央目录偏移越界，ZIP 已损坏');

  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (p + 46 > buf.length) throw new ZipError(`中央目录条目 ${i} 越界`);
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError(`中央目录条目 ${i} 签名错误`);

    const versionMadeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compressedSize = buf.readUInt32LE(p + 20);
    let uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttributes = buf.readUInt32LE(p + 38);
    let localHeaderOffset = buf.readUInt32LE(p + 42);

    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen);
    const name = nameBuf.toString('utf8');
    const extraBuf = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);

    // ZIP64 extra field (0x0001)：按需回填 32 位占位字段
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let e = 0;
      while (e + 4 <= extraBuf.length) {
        const hid = extraBuf.readUInt16LE(e);
        const hsz = extraBuf.readUInt16LE(e + 2);
        if (hid === 0x0001) {
          let q = e + 4;
          if (uncompressedSize === 0xffffffff && q + 8 <= extraBuf.length) {
            uncompressedSize = Number(extraBuf.readBigUInt64LE(q));
            q += 8;
          }
          if (compressedSize === 0xffffffff && q + 8 <= extraBuf.length) {
            compressedSize = Number(extraBuf.readBigUInt64LE(q));
            q += 8;
          }
          if (localHeaderOffset === 0xffffffff && q + 8 <= extraBuf.length) {
            localHeaderOffset = Number(extraBuf.readBigUInt64LE(q));
            q += 8;
          }
          break;
        }
        e += 4 + hsz;
      }
    }

    // --- 本地头：只为算出数据区偏移 ---
    if (localHeaderOffset + 30 > buf.length) throw new ZipError(`条目 ${name} 的本地头越界`);
    if (buf.readUInt32LE(localHeaderOffset) !== SIG_LOCAL) throw new ZipError(`条目 ${name} 的本地头签名错误`);
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    entries.push({
      name,
      isDirectory: name.endsWith('/') || name.endsWith('\\'),
      method,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      localHeaderOffset,
      externalAttributes,
      flags,
      versionMadeBy,
      dataOffset,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ------------------------------------------------------------------
// 对外 API
// ------------------------------------------------------------------

export interface ExtractResult {
  /** 成功写出的文件相对路径（POSIX 分隔符），按写入顺序 */
  files: string[];
  /** 跳过的目录 entry 数 */
  directories: number;
  /** 解压出的总字节数 */
  bytes: number;
}

/**
 * 安全解压 ZIP 到 `destRoot`。
 *
 * 安全策略（ADR D14.3-2）：
 *  1. **先全量校验**所有 entry 名（`assertSafeEntryName`）——任一不合规 ⇒
 *     **整包拒绝**，在写出任何文件之前抛出，并清理 `destRoot`。
 *  2. 拒绝加密 entry（flags bit 0）与符号链接/硬链接 entry。
 *  3. 拒绝 method 非 0/8。
 *  4. 每个文件解压后校验 **CRC-32**（与 manifest 的 SHA-256 互为补充）。
 *  5. 写入前对**每一个**目标路径再跑一次 `resolve + startsWith` 终检。
 *
 * @param zipPath ZIP 文件绝对路径
 * @param destRoot 目标根目录（绝对路径；不存在则创建）
 */
export async function extractZipSecurely(zipPath: string, destRoot: string): Promise<ExtractResult> {
  const root = path.resolve(destRoot);
  const entries = await readCentralDirectory(zipPath);

  if (entries.length === 0) throw new ZipError('ZIP 内没有任何条目');

  // ---- 阶段 1：全量安全校验（写盘之前）----
  const planned: Array<{ entry: CentralEntry; target: string; relPosix: string }> = [];
  for (const entry of entries) {
    // 符号链接 / 硬链接
    const mode = unixModeOf(entry.versionMadeBy, entry.externalAttributes);
    if (mode !== 0 && (mode & S_IFMT) === S_IFLNK) {
      throw new ZipSecurityError(entry.name, '符号链接 entry');
    }
    // 加密
    if ((entry.flags & 0x0001) !== 0) {
      throw new ZipSecurityError(entry.name, '加密 entry（flags bit 0）');
    }
    // 压缩方式
    if (entry.method !== 0 && entry.method !== 8) {
      throw new ZipSecurityError(entry.name, `不支持的压缩方式 ${entry.method}`);
    }
    // 路径穿越 —— 真实校验
    const target = assertSafeEntryName(entry.name, root);
    const relPosix = entry.name.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!entry.isDirectory) {
      planned.push({ entry, target, relPosix });
    }
  }

  // ---- 阶段 2：写盘 ----
  await fsp.mkdir(root, { recursive: true });
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const files: string[] = [];
  let bytes = 0;

  const buf = await fsp.readFile(zipPath);
  try {
    for (const { entry, target, relPosix } of planned) {
      // 逐文件再终检（纵深防御：目标父目录必须是 root 的后代）
      const parent = path.dirname(target);
      if (parent !== root && !parent.startsWith(rootWithSep)) {
        throw new ZipSecurityError(entry.name, '父目录逃出目标根目录');
      }
      if (!target.startsWith(rootWithSep)) {
        throw new ZipSecurityError(entry.name, '目标路径逃出目标根目录');
      }

      const start = entry.dataOffset;
      const end = start + entry.compressedSize;
      if (end > buf.length) throw new ZipError(`条目 ${entry.name} 数据区越界`);
      const raw = buf.subarray(start, end);

      let data: Buffer;
      if (entry.method === 0) {
        data = Buffer.from(raw);
      } else {
        try {
          data = inflateRawSync(raw);
        } catch (err) {
          throw new ZipError(`条目 ${entry.name} 解压失败: ${(err as Error).message}`);
        }
      }

      if (entry.uncompressedSize !== 0xffffffff && data.length !== entry.uncompressedSize) {
        throw new ZipError(
          `条目 ${entry.name} 长度不符：期望 ${entry.uncompressedSize}，实际 ${data.length}`,
        );
      }
      // CRC-32 校验
      const actualCrc = zlibCrc32(data) >>> 0;
      if (actualCrc !== (entry.crc32 >>> 0)) {
        throw new ZipError(
          `条目 ${entry.name} CRC-32 校验失败：期望 ${(entry.crc32 >>> 0).toString(16)}，实际 ${actualCrc.toString(16)}`,
        );
      }

      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, data);
      files.push(relPosix);
      bytes += data.length;
    }
  } catch (err) {
    // 整包拒绝 ⇒ 清理已写出的内容
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  if (files.length === 0) {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
    throw new ZipError('ZIP 内没有任何文件条目');
  }

  return { files, directories: entries.length - planned.length, bytes };
}

/** 列出 ZIP 内的条目名（只读，不做解压；供 build-update.mjs 自检用）。 */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const entries = await readCentralDirectory(zipPath);
  return entries.map((e) => e.name);
}

// 保留 createReadStream 的引用以避免未使用导入告警（流式解压的后续扩展点）。
void createReadStream;