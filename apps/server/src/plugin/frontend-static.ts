// ============================================================
// 生产环境静态文件服务 —— webServer fallback 席位（SPA 回退）
// 仅在 NODE_ENV=production 且 dist 存在时由宿主注册。
// ============================================================

import { readFileSync, existsSync, statSync } from 'fs';
import { dirname, extname, resolve, sep } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.map': 'application/json',
};

/**
 * 构造 webServer fallback：命中文件则返回，未命中回退 index.html（SPA 路由）。
 * @param indexFilePath - dist 下 index.html 的绝对路径（与 DSH frontend-static 契约一致）
 */
export function createStaticFallback(indexFilePath: string) {
  const distRoot = dirname(indexFilePath);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const rawPath = new URL(req.url ?? '/', 'http://localhost').pathname;
    const reqPath = rawPath === '/' ? '/index.html' : rawPath;

    // C15：双保险防路径穿越。
    // WHATWG URL 已对 .. 归一化，这里再对「解码后的绝对路径」做 resolve + 前缀校验，
    // 任何越界（编码变体 / 反斜杠 / 双重编码等）一律 403，绝不落到 SPA 回退或文件读取。
    let filePath: string;
    try {
      const decoded = decodeURIComponent(reqPath);
      filePath = resolve(distRoot, '.' + decoded);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }
    const root = resolve(distRoot);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    try {
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = extname(filePath);
        const body = readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Content-Length': body.length,
        });
        res.end(body);
        return;
      }
    } catch {
      // 落到 SPA 回退
    }
    const html = readFileSync(indexFilePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
  };
}
