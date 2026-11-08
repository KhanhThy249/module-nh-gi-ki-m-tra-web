// Bộ đọc HTML nhỏ gọn, không cần thư viện ngoài.
// Tạo cây phần tử, mỗi phần tử nhớ vị trí trong mã nguồn (số dòng, vị trí bắt đầu/kết thúc)
// để trích bằng chứng chính xác.

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
// Nội dung bên trong các thẻ này là chữ thô, không phải HTML (giống cách trình duyệt đọc).
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'xmp', 'noembed', 'noframes', 'iframe']);
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'ul',
]);

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', middot: '·', bull: '•', trade: '™',
};

export function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try { return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m; } catch { return m; }
    }
    const v = NAMED[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(str) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(str))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue; // giữ thuộc tính đầu tiên như trình duyệt
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

/**
 * Đọc chuỗi HTML thành cây.
 * Phần tử: { type:'element', tag, attrs, children, parent, start, end, line }
 * Chữ:     { type:'text', text, parent }
 */
export function parseHTML(src) {
  const lineOf = lineIndex(src);
  const root = { type: 'root', tag: '#root', attrs: {}, children: [], parent: null, start: 0, end: src.length, line: 1 };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const len = src.length;
  let i = 0;

  const addText = (text) => {
    if (!text) return;
    top().children.push({ type: 'text', text: decodeEntities(text), parent: top() });
  };
  const closeTo = (idx, endPos) => {
    while (stack.length > idx) {
      const el = stack.pop();
      if (el.end === undefined) el.end = endPos;
    }
  };
  const findOpen = (tag, stopAt) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === tag) return k;
      if (stopAt && stopAt.has(stack[k].tag)) return -1;
    }
    return -1;
  };

  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));
    i = lt;

    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e === -1 ? len : e + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const e = src.indexOf('>', i);
      i = e === -1 ? len : e + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const m = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)[^>]*>?/.exec(src.slice(i, i + 200));
      if (!m) { addText('<'); i += 1; continue; }
      const tag = m[1].toLowerCase();
      const endPos = i + m[0].length;
      const idx = findOpen(tag);
      if (idx > 0) closeTo(idx, endPos);
      i = endPos;
      continue;
    }
    const sm = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(i, i + 100));
    if (!sm) { addText('<'); i += 1; continue; }

    // tìm dấu '>' kết thúc thẻ, bỏ qua '>' nằm trong dấu nháy
    let j = i + sm[0].length, quote = null;
    while (j < len) {
      const c = src[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    const tag = sm[1].toLowerCase();
    const inner = src.slice(i + sm[0].length, j);
    const selfClosing = /\/\s*$/.test(inner);
    const tagEnd = Math.min(j + 1, len);

    // đóng ngầm định giống trình duyệt cho một số thẻ hay viết thiếu thẻ đóng
    if (CLOSES_P.has(tag)) { const k = findOpen('p', new Set(['button', 'table'])); if (k > 0) closeTo(k, i); }
    if (tag === 'li') { const k = findOpen('li', new Set(['ul', 'ol'])); if (k > 0) closeTo(k, i); }
    if (tag === 'option') { const k = findOpen('option', new Set(['select'])); if (k > 0) closeTo(k, i); }
    if (tag === 'dt' || tag === 'dd') {
      const stop = new Set(['dl']);
      const k = Math.max(findOpen('dt', stop), findOpen('dd', stop));
      if (k > 0) closeTo(k, i);
    }
    if (tag === 'td' || tag === 'th') {
      const stop = new Set(['tr', 'table']);
      const k = Math.max(findOpen('td', stop), findOpen('th', stop));
      if (k > 0) closeTo(k, i);
    }
    if (tag === 'tr') { const k = findOpen('tr', new Set(['table'])); if (k > 0) closeTo(k, i); }

    const el = {
      type: 'element', tag, attrs: parseAttrs(inner.replace(/\/\s*$/, '')), children: [],
      parent: top(), start: i, end: undefined, line: lineOf(i),
    };
    top().children.push(el);
    i = tagEnd;

    if (VOID.has(tag) || selfClosing) { el.end = tagEnd; continue; }

    if (RAW.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'ig');
      closeRe.lastIndex = i;
      const cm = closeRe.exec(src);
      const contentEnd = cm ? cm.index : len;
      const raw = src.slice(i, contentEnd);
      if (raw) {
        el.children.push({
          type: 'text',
          text: tag === 'title' || tag === 'textarea' ? decodeEntities(raw) : raw,
          parent: el, raw: true,
        });
      }
      el.end = cm ? cm.index + cm[0].length : len;
      i = el.end;
      continue;
    }
    stack.push(el);
  }
  closeTo(1, len);
  return root;
}
