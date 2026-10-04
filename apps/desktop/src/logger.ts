// ============================================================
// apps/desktop/src/logger.ts
// 主进程日志 + 子进程 stdout/stderr 落盘（ADR-0008 D2 第 7 项、D7.1）。
//
// 冻结落点（D7.1 逐字）：
//   <userData>/logs/main.log
//   <userData>/logs/server.out.log
//   <userData>/logs/server.err.log
//   <userData>/logs/initial-admin-password.txt   （0o600，见 D6.2）
//
// 附加能力（派工书能力 6 要求）：
//   「同时保留内存环形缓冲供错误上报用」—— 崩溃对话框要展示
//   stderr 末尾 2000 字符（D5.3）与最近日志尾部（D12.4），
//   因此除了落盘，还必须在内存里保留定长环形缓冲。
//
// 设计取舍：
//   - 用 `fs.createWriteStream(path, { flags: 'a' })` 追加写，避免
//     每次日志都 open/close；进程退出时 flush。
//   - 环形缓冲按**行**保存（不是字节），保证对话框里不会截断半行。
//   - `stderrTail(n)` 返回**字符**数而非字节数：D5.3 冻结的措辞是
//     「stderr 末 2000 字符」，中文按字符计。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

import type { LogLevel, Logger, ServerStream } from './types.js';

/** 环形缓冲保留的最大行数（每行按 UTF-16 字符计长度上限另行裁剪）。 */
const RING_CAPACITY = 500;

/** 单行在环形缓冲中的最大保留字符数（防止一条超长日志挤爆内存）。 */
const RING_MAX_LINE_CHARS = 8000;

/** stderr 末尾快照的默认字符数（D5.3 冻结值 2000）。 */
export const STDERR_TAIL_CHARS = 2000;

interface RingBuffer {
  lines: string[];
  /** 已被覆盖的累计行数，仅用于诊断。 */
  dropped: number;
}

function createRing(): RingBuffer {
  return { lines: [], dropped: 0 };
}

function ringPush(ring: RingBuffer, line: string): void {
  const trimmed =
    line.length > RING_MAX_LINE_CHARS
      ? `${line.slice(0, RING_MAX_LINE_CHARS)}…[truncated]`
      : line;
  ring.lines.push(trimmed);
  if (ring.lines.length > RING_CAPACITY) {
    const overflow = ring.lines.length - RING_CAPACITY;
    ring.lines.splice(0, overflow);
    ring.dropped += overflow;
  }
}

/** 取环形缓冲末尾 `count` 行，拼成多行字符串。 */
function ringTail(ring: RingBuffer, count: number): string {
  return ring.lines.slice(-count).join('\n');
}

/** 取环形缓冲末尾 `chars` **字符**（不足则全给）。 */
function ringTailChars(ring: RingBuffer, chars: number): string {
  const joined = ring.lines.join('\n');
  return joined.length <= chars ? joined : joined.slice(joined.length - chars);
}

/**
 * 单文件日志器：一个追加写流 + 一个内存环形缓冲。
 */
class FileLogger {
  private readonly stream: fs.WriteStream | null;
  private readonly ring: RingBuffer = createRing();
  private readonly filePath: string;
  private writeFailed = false;

  constructor(filePath: string, private readonly echoToConsole: boolean) {
    this.filePath = filePath;
    let stream: fs.WriteStream | null = null;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
      // 流错误（磁盘满 / 权限）不能让主进程崩：置标志位，后续只写内存。
      stream.on('error', () => {
        this.writeFailed = true;
      });
    } catch {
      this.writeFailed = true;
    }
    this.stream = stream;
  }

  /** 写一行（自动补 ISO8601 前缀与级别）。 */
  write(level: LogLevel, message: string): void {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    ringPush(this.ring, line);
    if (this.echoToConsole) {
      const sink =
        level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      sink(line);
    }
    if (this.stream !== null && !this.writeFailed) {
      this.stream.write(`${line}\n`);
    }
  }

  /**
   * 写一行**原始**子进程输出（不加时间戳前缀）。
   *
   * 为什么保留原样：D6.2 的管理员密码正则与 D5.1 的端口正则都要求
   * `^\[Server\] …` 行首锚定；若在落盘前插入时间戳前缀，日志文件将
   * 无法用同一正则复核（t5/t6 要拿 `server.err.log` 验证 D13.3 的
   * `[Server] 收到 stdin，正在优雅关闭...`）。因此子进程输出**逐字**落盘。
   */
  writeRaw(line: string): void {
    ringPush(this.ring, line);
    if (this.echoToConsole) {
      console.log(line);
    }
    if (this.stream !== null && !this.writeFailed) {
      this.stream.write(`${line}\n`);
    }
  }

  /** 内存环形缓冲的末尾 `count` 行。 */
  tail(count: number): string {
    return ringTail(this.ring, count);
  }

  /** 内存环形缓冲的末尾 `chars` 字符（D5.3 的 2000 字符语义）。 */
  tailChars(chars: number): string {
    return ringTailChars(this.ring, chars);
  }

  /** 落盘文件绝对路径。 */
  get path(): string {
    return this.filePath;
  }

  /** flush 并关闭写流（优雅退出时调用）。 */
  close(): void {
    if (this.stream !== null && !this.writeFailed) {
      try {
        this.stream.end();
      } catch {
        /* 关闭失败不影响退出 */
      }
    }
  }
}

/**
 * shell 日志门面：主日志 + 子进程两条流。
 *
 * `stderrTail()` 是崩溃/启动失败对话框的内容来源，**跨主日志与
 * server.err.log 合并**取末尾字符，因为启动早期的失败原因可能只出现在
 * 其中一侧（例如 spawn 失败只写主日志，tsx 报错只写 stderr）。
 */
export class ShellLogger {
  private readonly main: FileLogger;
  private readonly serverOut: FileLogger;
  private readonly serverErr: FileLogger;

  constructor(layout: { logsDir: string; mainLogPath: string; serverOutLogPath: string; serverErrLogPath: string }) {
    this.main = new FileLogger(layout.mainLogPath, true);
    // 子进程输出同时 echo 到主进程 stdout/stderr 便于真机冒烟观察。
    this.serverOut = new FileLogger(layout.serverOutLogPath, true);
    this.serverErr = new FileLogger(layout.serverErrLogPath, true);
  }

  /** 主进程日志函数（可直接注入各模块）。 */
  readonly log: Logger = (level, message) => {
    this.main.write(level, message);
  };

  /** 便捷方法。 */
  debug(message: string): void {
    this.main.write('debug', message);
  }
  info(message: string): void {
    this.main.write('info', message);
  }
  warn(message: string): void {
    this.main.write('warn', message);
  }
  error(message: string): void {
    this.main.write('error', message);
  }

  /** 子进程一行输出：`stream` 决定落哪条日志。 */
  serverLine(stream: ServerStream, line: string): void {
    if (stream === 'err') {
      this.serverErr.writeRaw(line);
    } else {
      this.serverOut.writeRaw(line);
    }
  }

  /**
   * stderr 末尾 `chars` 字符（默认 D5.3 冻结的 2000）。
   *
   * 合并顺序：先主日志、后 server stderr —— 保证真正「最后发生的事」
   * 出现在末尾。启动失败时主日志里往往有 `[shell] …` 的装配说明，
   * 而真正的报错在 server stderr 尾部。
   */
  stderrTail(chars: number = STDERR_TAIL_CHARS): string {
    const merged = `${this.main.tailChars(chars)}\n${this.serverErr.tailChars(chars)}`;
    return merged.length <= chars ? merged : merged.slice(merged.length - chars);
  }

  /** 主日志末尾 `count` 行（D12.4「最近日志尾部」）。 */
  mainTail(count: number): string {
    return this.main.tail(count);
  }

  /** server stderr 末尾 `count` 行。 */
  serverErrTail(count: number): string {
    return this.serverErr.tail(count);
  }

  /** 是否已在 stderr 中见过某标记（供 D6.2 去重与 D13.3 复核）。 */
  get errFilePath(): string {
    return this.serverErr.path;
  }

  get mainFilePath(): string {
    return this.main.path;
  }

  /** flush 全部写流（优雅退出时调用）。 */
  close(): void {
    this.main.close();
    this.serverOut.close();
    this.serverErr.close();
  }
}