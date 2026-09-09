// ============================================================
// 搜索 Service - 代理外部搜索 API
// 提供 DuckDuckGo Instant Answer API + HTML 回退 + 内存缓存
// ============================================================

/** 搜索结果项 */
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/** 缓存条目 */
interface CacheEntry {
  results: SearchResultItem[];
  expireAt: number;
}

/** 内存缓存（60s TTL），避免重复查询 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

// 定期清理过期缓存（每 5 分钟）
// unref() 让定时器不阻止进程退出；shutdown 时由进程生命周期回收
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expireAt < now) cache.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

/** DuckDuckGo Instant Answer API 响应 */
interface DuckDuckGoApiResponse {
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Results?: { Text: string; FirstURL: string }[];
}

/**
 * 调用 DuckDuckGo Instant Answer API（JSON 端点）
 * 失败时返回 null，由上层回退到 HTML 爬取
 */
async function queryDuckDuckGoAPI(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResultItem[] | null> {
  const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&skip_disambig=1&no_html=1`;

  try {
    const timeoutSignal = AbortSignal.timeout(8000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: combinedSignal,
    });

    if (!response.ok) return null;

    let data: DuckDuckGoApiResponse;
    try {
      data = (await response.json()) as DuckDuckGoApiResponse;
    } catch {
      // JSON 解析失败，回退到 HTML
      return null;
    }

    const results: SearchResultItem[] = [];

    // 添加摘要结果
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || '摘要',
        snippet: data.AbstractText,
        url: data.AbstractURL,
      });
    }

    // 添加 Related Topics / Results
    if (data.Results && Array.isArray(data.Results)) {
      for (const item of data.Results.slice(0, maxResults)) {
        if (item.Text && item.FirstURL) {
          results.push({
            title: item.Text.split(' - ')[0] || item.Text,
            snippet: item.Text,
            url: item.FirstURL,
          });
        }
      }
    }

    return results.length > 0 ? results.slice(0, maxResults) : null;
  } catch (error) {
    // 网络失败、超时等
    console.warn('[SearchService] DuckDuckGo API 调用失败:', error);
    return null;
  }
}

/**
 * 调用 DuckDuckGo HTML 端点并解析（API 失败时的回退方案）
 */
async function queryDuckDuckGoHTML(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const fallbackUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`;

  const timeoutSignal = AbortSignal.timeout(10000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(fallbackUrl, {
    method: 'GET',
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML 请求失败: ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoHTML(html, maxResults);
}

/**
 * 解析 DuckDuckGo HTML 结果（回退方案）
 * 从前端 webSearchService.ts 迁移
 */
function parseDuckDuckGoHTML(html: string, maxResults: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const resultPattern = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = resultPattern.exec(html)) !== null && count < maxResults) {
    const url = match[1];
    if (!url) continue;
    const title = decodeHTMLEntities(match[2] ?? '');
    const snippet = decodeHTMLEntities((match[3] ?? '').replace(/<[^>]*>/g, ''));

    if (title && snippet) {
      results.push({ title, snippet, url });
      count++;
    }
  }

  return results;
}

/**
 * 解码 HTML 实体
 */
function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  return text.replace(/&[^;]+;/g, (match) => entities[match] || match);
}

/**
 * 执行网页搜索（带 60s 内存缓存）
 * 顺序：缓存命中 → DuckDuckGo Instant Answer API → DuckDuckGo HTML 回退
 *
 * @param query 搜索关键词
 * @param maxResults 最大结果数（默认 5）
 * @param signal 可选的 AbortSignal
 * @returns 搜索结果列表（失败时返回空数组）
 */
export async function searchWeb(
  query: string,
  maxResults = 5,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  // 1. 命中缓存则直接返回
  const cacheKey = `${query}::${maxResults}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expireAt > Date.now()) {
    return cached.results;
  }

  // 2. 优先 DuckDuckGo Instant Answer API
  const apiResults = await queryDuckDuckGoAPI(query, maxResults, signal);
  if (apiResults && apiResults.length > 0) {
    cache.set(cacheKey, { results: apiResults, expireAt: Date.now() + CACHE_TTL_MS });
    return apiResults;
  }

  // 3. 回退到 HTML 爬取
  try {
    const htmlResults = await queryDuckDuckGoHTML(query, maxResults, signal);
    if (htmlResults.length > 0) {
      cache.set(cacheKey, { results: htmlResults, expireAt: Date.now() + CACHE_TTL_MS });
    }
    return htmlResults;
  } catch (error) {
    console.error('[SearchService] 所有搜索方式均失败:', error);
    return [];
  }
}
