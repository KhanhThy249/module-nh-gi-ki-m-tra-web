// Tải trang web phía máy chủ: theo dõi chuyển hướng, chặn địa chỉ nội bộ (SSRF),
// giới hạn thời gian và dung lượng, tải thêm robots.txt, sitemap và favicon.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MB = 1024 * 1024;

export class AuditError extends Error {
  constructor(message) { super(message); this.name = 'AuditError'; }
}
export const MESSAGES = {
  invalid: 'URL không hợp lệ',
  unreachable: 'Không truy cập được website',
  timeout: 'Website phản hồi quá chậm (quá 10 giây)',
  tooLarge: 'Trang quá lớn (trên 2 MB)',
  private: 'Không được phép kiểm tra địa chỉ nội bộ',
  notHtml: 'Nội dung trả về không phải trang HTML',
};

export function normalizeUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new AuditError(MESSAGES.invalid);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { throw new AuditError(MESSAGES.invalid); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AuditError(MESSAGES.invalid);
  if (!u.hostname || /\s/.test(u.hostname)) throw new AuditError(MESSAGES.invalid);
  if (!u.hostname.includes('.') && !u.hostname.startsWith('[') && u.hostname !== 'localhost') {
    throw new AuditError(MESSAGES.invalid);
  }
  u.hash = '';
  return u.toString();
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((a, p) => (a << 8) + Number(p), 0) >>> 0;
}
function inV4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16],
      ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10],
    ].some(([b, n]) => inV4(ip, b, n));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateIp(mapped[1]);
    if (s === '::1' || s === '::') return true;
    const first = parseInt(s.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    return false;
  }
  return true;
}

async function assertPublic(urlStr, opts) {
  if (opts.allowPrivate) return;
  const host = new URL(urlStr).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new AuditError(MESSAGES.private);
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new AuditError(MESSAGES.private);
    return;
  }
  let addrs;
  try { addrs = await (opts.lookup || dns.lookup)(host, { all: true }); }
  catch { throw new AuditError(MESSAGES.unreachable); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new AuditError(MESSAGES.private);
}

async function readBody(res, maxBytes, truncateOnLimit) {
  if (!res.body) return { buf: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch { /* bỏ qua */ }
      if (!truncateOnLimit) throw new AuditError(MESSAGES.tooLarge);
      chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
      return { buf: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated: false };
}

function decode(buf, contentType) {
  const m = /charset=([^;]+)/i.exec(contentType || '');
  const cs = (m ? m[1].trim().replace(/["']/g, '') : 'utf-8').toLowerCase();
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/** Gửi một yêu cầu an toàn, tự xử lý chuyển hướng (tối đa 5 lần). */
export async function safeRequest(url, opts = {}) {
  const {
    method = 'GET', timeoutMs = 10000, maxBytes = 2 * MB, truncateOnLimit = false,
    accept = 'text/html,application/xhtml+xml,*/*;q=0.8', fetchImpl = globalThis.fetch,
  } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      await assertPublic(current, opts);
      let res;
      try {
        res = await fetchImpl(current, {
          method, redirect: 'manual', signal: ctrl.signal,
          headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
        });
      } catch (e) {
        if (ctrl.signal.aborted) throw new AuditError(MESSAGES.timeout);
        throw new AuditError(MESSAGES.unreachable);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        try { await res.body?.cancel(); } catch { /* bỏ qua */ }
        if (hop === 5) throw new AuditError(MESSAGES.unreachable + ' (chuyển hướng quá nhiều lần)');
        let next;
        try { next = new URL(res.headers.get('location'), current).toString(); } catch { throw new AuditError(MESSAGES.unreachable); }
        if (!/^https?:/i.test(next)) throw new AuditError(MESSAGES.unreachable);
        current = next;
        continue;
      }
      let body = '';
      let truncated = false;
      if (method !== 'HEAD') {
        try {
          const r = await readBody(res, maxBytes, truncateOnLimit);
          body = decode(r.buf, res.headers.get('content-type'));
          truncated = r.truncated;
          return { url: current, status: res.status, headers: res.headers, body, sizeBytes: r.buf.length, truncated, elapsedMs: Date.now() - started };
        } catch (e) {
          if (e instanceof AuditError) throw e;
          if (ctrl.signal.aborted) throw new AuditError(MESSAGES.timeout);
          throw new AuditError(MESSAGES.unreachable);
        }
      }
      try { await res.body?.cancel(); } catch { /* bỏ qua */ }
      return { url: current, status: res.status, headers: res.headers, body, sizeBytes: 0, truncated, elapsedMs: Date.now() - started };
    }
    throw new AuditError(MESSAGES.unreachable);
  } finally {
    clearTimeout(timer);
  }
}

async function optional(fn) {
  try { return await fn(); } catch { return null; }
}

export async function fetchPage(inputUrl, opts = {}) {
  const url = normalizeUrl(inputUrl);
  const main = await safeRequest(url, { ...opts, timeoutMs: 10000, maxBytes: 2 * MB });
  if (main.status >= 400) {
    throw new AuditError(`${MESSAGES.unreachable} (máy chủ trả về mã lỗi ${main.status})`);
  }
  const ct = (main.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('html')) throw new AuditError(MESSAGES.notHtml);

  const finalUrl = main.url;
  const origin = new URL(finalUrl).origin;
  const html = main.body;
  const aux = { ...opts, timeoutMs: 5000 };

  const hasIconLink = /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*icon/i.test(html);
  const [faviconIcoExists, robotsTxt] = await Promise.all([
    hasIconLink ? Promise.resolve(false) : optional(async () => {
      let r = await safeRequest(origin + '/favicon.ico', { ...aux, method: 'HEAD', accept: '*/*' });
      if (r.status === 405 || r.status === 501) {
        r = await safeRequest(origin + '/favicon.ico', { ...aux, maxBytes: 1024, truncateOnLimit: true, accept: '*/*' });
      }
      return r.status >= 200 && r.status < 300;
    }).then((v) => v === true),
    optional(async () => {
      const r = await safeRequest(origin + '/robots.txt', { ...aux, maxBytes: 500 * 1024, truncateOnLimit: true, accept: 'text/plain,*/*' });
      return { url: r.url, status: r.status, body: r.status >= 200 && r.status < 300 ? r.body : '' };
    }),
  ]);

  const candidates = [];
  if (robotsTxt && robotsTxt.status >= 200 && robotsTxt.status < 300) {
    const m = /^\s*sitemap\s*:\s*(\S+)/im.exec(robotsTxt.body);
    if (m) { try { candidates.push(new URL(m[1], origin).toString()); } catch { /* bỏ qua */ } }
  }
  candidates.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml');
  let sitemap = null;
  for (const c of [...new Set(candidates)]) {
    const r = await optional(() => safeRequest(c, { ...aux, maxBytes: 2 * MB, truncateOnLimit: true, accept: 'application/xml,text/xml,*/*' }));
    if (r && r.status >= 200 && r.status < 300) { sitemap = { url: r.url, status: r.status, body: r.body }; break; }
  }

  return {
    inputUrl: String(inputUrl), finalUrl, html, status: main.status,
    responseTimeMs: main.elapsedMs, sizeBytes: main.sizeBytes,
    faviconIcoExists, robotsTxt, sitemap,
  };
}
