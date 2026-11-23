import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { SearchResult } from "../src/shared";
export function isPublicIP(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublic(input: string) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("参考链接只支持无登录信息的公开 HTTP/HTTPS 页面");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    throw new Error("不允许读取本机或内网地址");
  const addresses = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv6" ? 6 : 4 }]
    : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((x) => !isPublicIP(x.address)))
    throw new Error("参考地址解析到非公开网络，已拒绝读取");
  return { url, addresses };
}
export async function fetchPublic(
  input: string,
  signal?: AbortSignal,
  depth = 0,
): Promise<{ url: string; html: string }> {
  if (depth > 4) throw new Error("网页重定向次数过多");
  const { url, addresses } = await resolvePublic(input);
  const response = await new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    buffer: Buffer;
  }>((resolve, reject) => {
    // Pin the checked DNS result to this connection, including every redirect.
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        signal,
        headers: {
          "User-Agent": "Gongzhuo/0.1 ReferenceReader",
          Accept: "text/html",
        },
        lookup: ((_host: any, opts: any, cb: any) => {
          if (opts?.all) cb(null, addresses);
          else cb(null, addresses[0].address, addresses[0].family);
        }) as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024) {
            res.destroy(new Error("网页过大，请使用本地导入"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("网页读取超时")));
    req.on("error", reject);
    req.end();
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.location
  )
    return fetchPublic(
      new URL(response.headers.location, url).href,
      signal,
      depth + 1,
    );
  if (response.status !== 200)
    throw new Error(
      `网页不可读取（HTTP ${response.status}），请粘贴或导入正文`,
    );
  if (!response.headers["content-type"]?.includes("text/html"))
    throw new Error("链接不是 HTML 网页，请通过文件导入");
  const charset =
    response.headers["content-type"]
      .match(/charset=([^; ]+)/i)?.[1]
      ?.replace(/["']/g, "") || "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset).decode(response.buffer);
  } catch {
    html = response.buffer.toString("utf8");
  }
  return { url: url.href, html };
}
export function extractArticle(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  dom.window.close();
  const text = article?.textContent?.trim() || "";
  if (text.length < 200)
    throw new Error("未提取到足够的正文，可能只有简介或需要登录，请手动导入");
  return {
    title: article?.title || url,
    text: text.slice(0, 300000),
    scope: "excerpt" as const,
    evidence: "仅确认读取到当前页面文本；全文完整性与热度尚未核实。",
  };
}
export async function searchReferences(
  key: string,
  query: string,
  options: { freshness?: string; signal?: AbortSignal } = {},
): Promise<SearchResult[]> {
  if (!key) throw new Error("请先配置 Brave Search API 密钥，或改用本地导入");
  const queries = [query, `${query} 小说 榜单`, `${query} 小说 作品 阅读`];
  const found = new Map<string, SearchResult>();
  for (const q of queries) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", q);
    url.searchParams.set("count", "10");
    url.searchParams.set("search_lang", "zh-hans");
    if (options.freshness) url.searchParams.set("freshness", options.freshness);
    const r = await fetch(url, {
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!r.ok)
      throw new Error(`搜索服务返回 HTTP ${r.status}，请检查密钥和额度`);
    const data = (await r.json()) as any;
    for (const item of data.web?.results || []) {
      try {
        const u = new URL(item.url);
        u.hash = "";
        if (!["http:", "https:"].includes(u.protocol)) continue;
        if (!found.has(u.href))
          found.set(u.href, {
            title: String(item.title),
            url: u.href,
            description: String(item.description || "").replace(/<[^>]+>/g, ""),
            reason: "与查询相关；尚未核实热度和正文范围",
          });
      } catch {}
    }
    if (found.size >= 10) break;
  }
  return [...found.values()].slice(0, 10);
}
