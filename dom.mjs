// Các hàm tiện ích để tìm phần tử và trích bằng chứng (vị trí, số dòng, đoạn mã).
import { parseHTML } from './htmlParser.mjs';

const SNIPPET_MAX = 160;
const HIDDEN_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg']);

export function norm(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}
export function lower(s) {
  return norm(s).normalize('NFC').toLowerCase();
}
export function charLen(s) {
  return Array.from(s).length;
}
export function truncate(s, max = SNIPPET_MAX) {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
}

/** Bọc mã nguồn thành một "trang" có các hàm tìm kiếm. */
export function loadDoc(html) {
  const root = parseHTML(html);
  const all = [];
  (function walk(node) {
    for (const c of node.children) {
      if (c.type === 'element') { all.push(c); walk(c); }
    }
  })(root);
  const byTag = new Map();
  for (const el of all) {
    if (!byTag.has(el.tag)) byTag.set(el.tag, []);
    byTag.get(el.tag).push(el);
  }
  return { html, root, all, byTag, cache: new Map() };
}

export function tags(doc, ...names) {
  if (names.length === 1) return doc.byTag.get(names[0]) || [];
  return doc.all.filter((el) => names.includes(el.tag));
}
export function attr(el, name) {
  const v = el.attrs[name];
  return v === undefined ? undefined : v;
}
export function attrLower(el, name) {
  const v = el.attrs[name];
  return v === undefined ? '' : String(v).trim().toLowerCase();
}
export function relTokens(el) {
  return attrLower(el, 'rel').split(/\s+/).filter(Boolean);
}
export function closest(el, pred) {
  let p = el.parent;
  while (p && p.type === 'element') {
    if (pred(p)) return p;
    p = p.parent;
  }
  return null;
}
export function textOf(el, { visibleOnly = false } = {}) {
  let out = '';
  (function walk(n) {
    for (const c of n.children) {
      if (c.type === 'text') { if (!(visibleOnly && c.raw && c.parent.tag !== 'title' && c.parent.tag !== 'textarea')) out += c.text + ' '; }
      else if (c.type === 'element' && !(visibleOnly && HIDDEN_TEXT_TAGS.has(c.tag))) walk(c);
    }
  })(el);
  return norm(out);
}

/** Chữ hiển thị của <body>: bỏ script/style/noscript, gộp khoảng trắng, chuẩn NFC, chữ thường. */
export function visibleText(doc) {
  if (!doc.cache.has('visibleText')) {
    const body = tags(doc, 'body')[0] || doc.root;
    let out = '';
    (function walk(n) {
      for (const c of n.children) {
        if (c.type === 'text') { if (!c.raw || c.parent.tag === 'textarea') out += c.text + ' '; }
        else if (c.type === 'element' && !HIDDEN_TEXT_TAGS.has(c.tag) && c.tag !== 'head' && c.tag !== 'title') walk(c);
      }
    })(body);
    doc.cache.set('visibleText', lower(out));
  }
  return doc.cache.get('visibleText');
}

/** Tên mà người dùng/phần mềm đọc màn hình nhận được cho liên kết hoặc nút. */
export function accessibleName(el) {
  const t = textOf(el, { visibleOnly: true });
  if (t) return t;
  for (const a of ['aria-label', 'aria-labelledby', 'title']) if (norm(attr(el, a))) return norm(attr(el, a));
  if (el.tag === 'input' && norm(attr(el, 'value'))) return norm(attr(el, 'value'));
  const imgs = [];
  (function walk(n) { for (const c of n.children) if (c.type === 'element') { if (c.tag === 'img') imgs.push(c); walk(c); } })(el);
  const alt = imgs.map((i) => norm(attr(i, 'alt'))).find(Boolean);
  return alt || '';
}

// ---------- Bằng chứng ----------

export function getLine(el) {
  return el && el.line;
}
export function getLocation(el) {
  if (!el) return 'Không xác định';
  if (el.tag === 'html') return 'Thẻ mở đầu của trang (<html>)';
  if (el.tag === 'head') return 'Phần đầu trang (<head>, khách không nhìn thấy)';
  let inBody = false;
  for (let p = el; p && p.type === 'element'; p = p.parent) {
    if (p.tag === 'head') return 'Phần đầu trang (<head>, khách không nhìn thấy)';
    if (p.tag === 'footer') return 'Chân trang';
    if (p.tag === 'header' || p.tag === 'nav') return 'Đầu trang / thanh menu';
    if (p.tag === 'body') inBody = true;
  }
  if (!inBody && ['title', 'meta', 'link', 'base'].includes(el.tag)) return 'Phần đầu trang (<head>, khách không nhìn thấy)';
  return 'Nội dung chính của trang';
}
/** Đoạn mã gốc của thẻ (chỉ phần thẻ mở nếu phần tử quá dài). */
export function getSnippet(doc, el) {
  const end = el.end ?? el.start + SNIPPET_MAX;
  let s = doc.html.slice(el.start, Math.min(end, el.start + 400));
  s = s.replace(/\s+/g, ' ').trim();
  return truncate(s);
}
export function ev(doc, el, value) {
  const e = { location: getLocation(el), line: getLine(el), snippet: getSnippet(doc, el) };
  if (value !== undefined && value !== '') e.value = String(value);
  return e;
}
export function evNote(location, value, snippet) {
  const e = { location };
  if (snippet) e.snippet = truncate(norm(snippet));
  if (value !== undefined && value !== '') e.value = String(value);
  return e;
}
export function evList(doc, els, valueFn) {
  return els.slice(0, 3).map((el) => ev(doc, el, valueFn ? valueFn(el) : undefined));
}

export function formatKB(bytes) {
  const kb = bytes / 1024;
  return (kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10).toLocaleString('vi-VN') + ' KB';
}
export function pct(n) {
  return Math.round(n * 100) + '%';
}
