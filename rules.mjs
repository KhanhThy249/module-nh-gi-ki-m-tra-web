// Logic chấm 60 tiêu chí. Mỗi hàm là "hàm thuần": chỉ đọc trang (doc) và dữ liệu đã tải (ctx),
// không gọi mạng, không dùng thời gian/ngẫu nhiên → cùng dữ liệu luôn cho cùng kết quả.
// Mỗi hàm trả về { status: 'pass'|'partial'|'fail', detail, evidence[] }.
import {
  tags, attr, attrLower, relTokens, closest, textOf, visibleText, accessibleName,
  ev, evNote, evList, norm, lower, charLen, formatKB, pct, getLocation,
} from './dom.mjs';

const HEAD = 'Phần đầu trang (<head>, khách không nhìn thấy)';
const WHOLE = 'Toàn bộ mã nguồn trang';
const BODY = 'Nội dung chính của trang';
const r = (status, detail, evidence) => ({ status, detail, evidence });
const ratioStatus = (ratio, passAt, partialAt) => (ratio >= passAt ? 'pass' : partialAt !== undefined && ratio >= partialAt ? 'partial' : 'fail');
const hasAncestor = (el, tag) => !!closest(el, (p) => p.tag === tag);

// ---------- dữ liệu dùng chung ----------
function metaBy(doc, key) {
  key = key.toLowerCase();
  return tags(doc, 'meta').filter((m) => attrLower(m, 'name') === key || attrLower(m, 'property') === key);
}
function metaContent(m) { return norm(attr(m, 'content')); }

function ldBlocks(doc) {
  if (!doc.cache.has('ld')) {
    const blocks = tags(doc, 'script').filter((s) => attrLower(s, 'type') === 'application/ld+json').map((el) => {
      const raw = textOf(el);
      let data = null, ok = true;
      try { data = JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, '')); } catch { ok = false; }
      return { el, ok, data };
    });
    const objects = [];
    const visit = (o) => {
      if (Array.isArray(o)) return o.forEach(visit);
      if (o && typeof o === 'object') {
        objects.push(o);
        for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
      }
    };
    blocks.forEach((b) => b.ok && visit(b.data));
    doc.cache.set('ld', { blocks, objects });
  }
  return doc.cache.get('ld');
}
function ldTypes(doc) {
  const out = new Set();
  for (const o of ldBlocks(doc).objects) {
    const t = o['@type'];
    (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'string').forEach((x) => out.add(x));
  }
  return out;
}
function ldHas(doc, re) {
  return [...ldTypes(doc)].filter((t) => re.test(t));
}
function ldEvidence(doc, value) {
  const b = ldBlocks(doc).blocks.find((x) => x.ok);
  return b ? ev(doc, b.el, value) : evNote(HEAD, value);
}
function anchors(doc) { return tags(doc, 'a'); }
function href(el) { return norm(attr(el, 'href')); }
function images(doc) { return tags(doc, 'img'); }
function originOf(ctx) { try { return new URL(ctx.finalUrl).origin; } catch { return ''; } }
function includesAny(s, words) { return words.find((w) => s.includes(w)); }

// ---------- A. SEO & hiển thị ----------
export function title(doc) {
  const t = tags(doc, 'title').find((el) => !hasAncestor(el, 'svg'));
  if (!t || !textOf(t)) {
    return r('fail', 'Trang không có tiêu đề (<title>) hoặc tiêu đề để trống.',
      [t ? ev(doc, t, 'Tiêu đề rỗng') : evNote('Đã tìm trong phần đầu trang (<head>), không có thẻ <title>')]);
  }
  const text = textOf(t);
  const n = charLen(text);
  const e = [ev(doc, t, `"${text}" (${n} ký tự)`)];
  if (n >= 10 && n <= 60) return r('pass', `Tiêu đề dài ${n} ký tự, nằm trong khoảng nên dùng 10–60 ký tự.`, e);
  return r('partial', n > 60
    ? `Tiêu đề dài ${n} ký tự, vượt mức 60 nên dễ bị Google cắt bớt.`
    : `Tiêu đề chỉ có ${n} ký tự, quá ngắn để mô tả trang (nên từ 10 ký tự).`, e);
}

export function meta_description(doc) {
  const m = metaBy(doc, 'description').filter((x) => attrLower(x, 'name') === 'description')[0];
  if (!m || !metaContent(m)) {
    return r('fail', 'Trang không có đoạn mô tả tìm kiếm (meta description) hoặc để trống.',
      [m ? ev(doc, m, 'Nội dung rỗng') : evNote('Đã tìm trong phần đầu trang (<head>), không có thẻ meta description')]);
  }
  const text = metaContent(m);
  const n = charLen(text);
  const e = [ev(doc, m, `${n} ký tự`)];
  if (n >= 50 && n <= 160) return r('pass', `Mô tả dài ${n} ký tự, nằm trong khoảng nên dùng 50–160 ký tự.`, e);
  return r('partial', n > 160 ? `Mô tả dài ${n} ký tự, vượt mức 160 nên sẽ bị cắt trên Google.` : `Mô tả chỉ có ${n} ký tự, quá ngắn (nên từ 50 ký tự).`, e);
}

export function open_graph(doc) {
  const keys = ['og:title', 'og:description', 'og:image'];
  const found = keys.map((k) => metaBy(doc, k).find((m) => metaContent(m))).map((m, i) => ({ k: keys[i], m }));
  const present = found.filter((x) => x.m);
  const missing = found.filter((x) => !x.m).map((x) => x.k);
  if (!present.length) return r('fail', 'Không có thẻ Open Graph nào, link chia sẻ lên Facebook/Zalo sẽ không có ảnh và mô tả đẹp.',
    [evNote('Đã tìm trong phần đầu trang (<head>), không có thẻ og:title, og:description, og:image')]);
  const e = present.map((x) => ev(doc, x.m));
  if (!missing.length) return r('pass', 'Có đủ og:title, og:description và og:image.', e);
  return r('partial', `Có ${present.map((x) => x.k).join(', ')} nhưng còn thiếu ${missing.join(', ')}.`, e);
}

export function canonical(doc) {
  const links = tags(doc, 'link').filter((l) => relTokens(l).includes('canonical') && href(l));
  if (!links.length) return r('fail', 'Không có thẻ khai báo địa chỉ chuẩn (canonical).',
    [evNote('Đã tìm trong phần đầu trang (<head>), không có <link rel="canonical">')]);
  const distinct = [...new Set(links.map(href))];
  if (distinct.length > 1) return r('partial', `Có ${links.length} thẻ canonical trỏ tới ${distinct.length} địa chỉ khác nhau, Google sẽ không biết chọn địa chỉ nào.`, evList(doc, links));
  return r('pass', `Có địa chỉ chuẩn: ${distinct[0]}`, [ev(doc, links[0])]);
}

export function robots_meta(doc) {
  const metas = tags(doc, 'meta').filter((m) => ['robots', 'googlebot'].includes(attrLower(m, 'name')));
  const blocking = metas.filter((m) => /(^|[\s,])(noindex|none)($|[\s,])/.test(attrLower(m, 'content')));
  if (blocking.length) return r('fail', 'Trang đang có lệnh "noindex" chặn Google đưa trang lên kết quả tìm kiếm.', evList(doc, blocking));
  if (metas.length) return r('pass', 'Có thẻ robots và không chặn Google.', evList(doc, metas));
  return r('pass', 'Không có lệnh chặn Google (mặc định Google được phép đưa trang lên kết quả tìm kiếm).',
    [evNote('Đã tìm trong phần đầu trang (<head>), không có thẻ meta robots chặn Google')]);
}

export function robots_txt(doc, ctx) {
  const loc = `File ${originOf(ctx)}/robots.txt trên máy chủ`;
  const rt = ctx.robotsTxt;
  if (!rt || !(rt.status >= 200 && rt.status < 300)) {
    return r('fail', 'Không tìm thấy tệp robots.txt.', [evNote(loc, rt ? `Máy chủ trả về mã ${rt.status}` : 'Không tải được tệp')]);
  }
  // tìm nhóm "User-agent: *" có "Disallow: /"
  const lines = rt.body.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());
  let agents = [], inRules = false, blockLine = null;
  for (const l of lines) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (inRules) { agents = []; inRules = false; } agents.push(v); }
    else { inRules = true; if (k === 'disallow' && v === '/' && agents.includes('*')) blockLine = l; }
  }
  if (blockLine) return r('partial', 'Có tệp robots.txt nhưng đang chặn toàn bộ website với mọi công cụ tìm kiếm.', [evNote(loc, 'Dòng chặn toàn bộ', blockLine)]);
  return r('pass', 'Có tệp robots.txt và không chặn toàn bộ website.', [evNote(loc, `Mã ${rt.status}`, rt.body.slice(0, 160))]);
}

function sitemapValid(ctx) {
  return !!(ctx.sitemap && /<(urlset|sitemapindex)[\s>]/i.test(ctx.sitemap.body));
}
export function sitemap(doc, ctx) {
  const sm = ctx.sitemap;
  if (!sm) return r('fail', 'Không tìm thấy sơ đồ trang (sitemap).',
    [evNote('Đã tìm trong robots.txt, ' + originOf(ctx) + '/sitemap.xml và /sitemap_index.xml', 'Không có tệp')]);
  const loc = `File ${sm.url}`;
  if (sitemapValid(ctx)) return r('pass', 'Có sitemap đúng định dạng XML.', [evNote(loc, `Mã ${sm.status}`, sm.body.slice(0, 160))]);
  return r('partial', 'Có tệp sitemap nhưng nội dung không đúng định dạng sitemap XML.', [evNote(loc, 'Không có thẻ <urlset> hoặc <sitemapindex>', sm.body.slice(0, 160))]);
}

export function structured_data(doc) {
  const { blocks } = ldBlocks(doc);
  if (!blocks.length) return r('fail', 'Không có dữ liệu có cấu trúc (JSON-LD).',
    [evNote('Đã tìm toàn trang, không có <script type="application/ld+json">')]);
  const bad = blocks.filter((b) => !b.ok);
  const types = [...ldTypes(doc)];
  if (bad.length) return r('partial', `Có ${blocks.length} khối JSON-LD nhưng ${bad.length} khối viết sai cú pháp nên Google không đọc được.`, evList(doc, bad.map((b) => b.el), () => 'JSON lỗi'));
  return r('pass', `Có ${blocks.length} khối JSON-LD hợp lệ${types.length ? ' (kiểu: ' + types.slice(0, 6).join(', ') + ')' : ''}.`,
    evList(doc, blocks.map((b) => b.el)));
}

export function twitter_card(doc) {
  const m = metaBy(doc, 'twitter:card').find((x) => metaContent(x));
  if (!m) return r('fail', 'Không có thẻ twitter:card.', [evNote('Đã tìm trong phần đầu trang (<head>), không có thẻ twitter:card')]);
  return r('pass', `Có thẻ twitter:card (${metaContent(m)}).`, [ev(doc, m)]);
}

export function breadcrumb(doc) {
  const t = ldHas(doc, /^BreadcrumbList$/i);
  if (t.length) return r('pass', 'Có dữ liệu BreadcrumbList.', [ldEvidence(doc, 'BreadcrumbList')]);
  const el = doc.all.find((e) => ['aria-label', 'class', 'id'].some((a) => attrLower(e, a).includes('breadcrumb')));
  if (el) return r('pass', 'Có dải đường dẫn trên trang.', [ev(doc, el)]);
  return r('fail', 'Không có dải đường dẫn (breadcrumb).', [evNote('Đã tìm toàn trang, không có BreadcrumbList hay phần tử breadcrumb')]);
}

export function sitemap_lastmod(doc, ctx) {
  if (!sitemapValid(ctx)) return r('fail', 'Không có sitemap hợp lệ nên không có ngày cập nhật.', [evNote('Sơ đồ trang (sitemap)', 'Không có sitemap hợp lệ')]);
  const m = /<lastmod>[^<]*<\/lastmod>/i.exec(ctx.sitemap.body);
  if (m) return r('pass', 'Sitemap có khai báo ngày cập nhật.', [evNote(`File ${ctx.sitemap.url}`, undefined, m[0])]);
  return r('fail', 'Sitemap không có thẻ <lastmod> nào.', [evNote(`File ${ctx.sitemap.url}`, 'Không có <lastmod>')]);
}

export function meta_keywords(doc) {
  const m = tags(doc, 'meta').filter((x) => attrLower(x, 'name') === 'keywords');
  if (m.length) return r('fail', 'Trang vẫn còn thẻ meta keywords lỗi thời.', evList(doc, m));
  return r('pass', 'Không còn thẻ meta keywords.', [evNote('Đã tìm trong phần đầu trang (<head>), không có thẻ meta keywords')]);
}

// ---------- B. Chuẩn kỹ thuật ----------
export function https(doc, ctx) {
  const ok = /^https:\/\//i.test(ctx.finalUrl);
  return r(ok ? 'pass' : 'fail', ok ? 'Trang dùng kết nối bảo mật HTTPS.' : 'Trang dùng http://, trình duyệt sẽ cảnh báo "Không bảo mật".',
    [evNote('Địa chỉ trang sau khi chuyển hướng', ctx.finalUrl)]);
}

export function lang(doc) {
  const h = tags(doc, 'html')[0];
  if (h && norm(attr(h, 'lang'))) return r('pass', `Trang khai báo ngôn ngữ: ${norm(attr(h, 'lang'))}.`, [ev(doc, h)]);
  return r('fail', 'Thẻ <html> không khai báo ngôn ngữ (lang).', [h ? ev(doc, h, 'Thiếu lang') : evNote('Không tìm thấy thẻ <html>')]);
}

export function charset(doc) {
  const m = tags(doc, 'meta').find((x) => norm(attr(x, 'charset')) ||
    (attrLower(x, 'http-equiv') === 'content-type' && /charset=/i.test(attr(x, 'content') || '')));
  if (m) return r('pass', 'Có khai báo bảng mã ký tự.', [ev(doc, m)]);
  return r('fail', 'Không khai báo bảng mã ký tự (charset).', [evNote('Đã tìm trong phần đầu trang (<head>), không có meta charset')]);
}

export function h1(doc) {
  const hs = tags(doc, 'h1');
  if (!hs.length) return r('fail', 'Trang không có tiêu đề chính H1.', [evNote('Đã tìm toàn trang, không có thẻ <h1>')]);
  if (hs.length > 1) return r('partial', `Trang có ${hs.length} thẻ H1, nên chỉ giữ một.`, evList(doc, hs, (el) => accessibleName(el)));
  const text = accessibleName(hs[0]);
  if (!text) return r('fail', 'Thẻ H1 không có chữ.', [ev(doc, hs[0], 'H1 rỗng')]);
  return r('pass', `Có đúng một H1: "${text}".`, [ev(doc, hs[0])]);
}

export function heading_system(doc) {
  const hs = doc.all.filter((e) => /^h[1-6]$/.test(e.tag));
  const levels = hs.map((e) => Number(e.tag[1]));
  if (!levels.includes(1)) return r('fail', 'Không có tiêu đề H1 nên hệ thống đề mục chưa có gốc.', [evNote('Đã tìm toàn trang, không có <h1>')]);
  if (!levels.includes(2)) return r('fail', 'Có H1 nhưng không có tiêu đề H2 nào.', [evNote('Đã tìm toàn trang, không có <h2>')]);
  for (let k = 1; k < hs.length; k++) {
    if (levels[k] - levels[k - 1] > 1) {
      return r('fail', `Đề mục nhảy cấp từ H${levels[k - 1]} xuống thẳng H${levels[k]}.`, [ev(doc, hs[k - 1]), ev(doc, hs[k], `H${levels[k - 1]} → H${levels[k]}`)]);
    }
  }
  return r('pass', `Có ${hs.length} đề mục, sắp xếp đúng thứ bậc.`, [evNote(BODY, levels.slice(0, 12).map((l) => 'H' + l).join(' → ') + (levels.length > 12 ? ' …' : ''))]);
}

function linkOk(a) {
  const h = href(a);
  return h && h !== '#' && !/^javascript:/i.test(h) && !!accessibleName(a);
}
export function links(doc) {
  const as = anchors(doc);
  if (!as.length) return r('fail', 'Trang không có liên kết nào.', [evNote('Đã tìm toàn trang, không có thẻ <a>')]);
  const bad = as.filter((a) => !linkOk(a));
  const ratio = (as.length - bad.length) / as.length;
  const msg = `${as.length - bad.length}/${as.length} liên kết (${pct(ratio)}) có địa chỉ hợp lệ và có tên.`;
  if (ratio >= 0.9) return r('pass', msg, bad.length ? evList(doc, bad, () => 'Liên kết lỗi') : [evNote(BODY, msg)]);
  return r('fail', msg + ' Cần từ 90%.', evList(doc, bad, () => 'Liên kết rỗng/"#"/javascript hoặc không có tên'));
}

const TRACKERS = [
  ['googletagmanager.com', 'Google Tag Manager / Google Analytics'], ['gtag/js', 'Google Analytics (gtag)'],
  ['google-analytics.com', 'Google Analytics'], ['fbevents.js', 'Facebook Pixel'], ['connect.facebook.net', 'Facebook SDK/Pixel'],
  ['assets.adobedtm.com', 'Adobe Analytics'], ['cdn.tagcommander.com', 'Commanders Act'], ['analytics.tiktok.com', 'TikTok Pixel'],
];
export function analytics(doc) {
  const h = doc.html.toLowerCase();
  const found = TRACKERS.filter(([m]) => h.includes(m));
  if (!found.length) return r('fail', 'Không tìm thấy công cụ đo lường nào (Google Analytics, Tag Manager, Facebook Pixel…).',
    [evNote('Đã tìm trong toàn bộ mã nguồn trang', 'Không có mã đo lường')]);
  const names = [...new Set(found.map((f) => f[1]))];
  const els = tags(doc, 'script').filter((s) => found.some(([m]) => (attr(s, 'src') || '').toLowerCase().includes(m) || textOf(s).toLowerCase().includes(m)));
  return r('pass', 'Tìm thấy: ' + names.join(', ') + '.', els.length ? evList(doc, els) : [evNote(WHOLE, names.join(', '))]);
}

export function duplicate_ids(doc) {
  const seen = new Map();
  for (const el of doc.all) {
    const id = norm(attr(el, 'id'));
    if (!id) continue;
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(el);
  }
  const dups = [...seen.entries()].filter(([, v]) => v.length > 1);
  if (!dups.length) return r('pass', `Không có id bị trùng (${seen.size} id).`, [evNote(WHOLE, `${seen.size} id, không trùng`)]);
  return r('fail', `Có ${dups.length} id bị trùng: ${dups.slice(0, 5).map(([k, v]) => `"${k}" (${v.length} lần)`).join(', ')}.`,
    dups.slice(0, 3).map(([k, v]) => ev(doc, v[1], `id "${k}" lặp ${v.length} lần`)));
}

export function mixed_content(doc, ctx) {
  if (!/^https:/i.test(ctx.finalUrl)) return r('fail', 'Trang chưa dùng HTTPS nên chưa đạt tiêu chí này.', [evNote('Địa chỉ trang sau khi chuyển hướng', ctx.finalUrl)]);
  const isHttp = (v) => /^\s*http:\/\//i.test(v || '') || /(^|,)\s*http:\/\//i.test(v || '');
  const active = [], passive = [];
  for (const el of doc.all) {
    if (el.tag === 'script' && isHttp(attr(el, 'src'))) active.push(el);
    else if (el.tag === 'link' && relTokens(el).includes('stylesheet') && isHttp(attr(el, 'href'))) active.push(el);
    else if (el.tag === 'iframe' && isHttp(attr(el, 'src'))) active.push(el);
    else if (['img', 'video', 'audio', 'source'].includes(el.tag) && (isHttp(attr(el, 'src')) || isHttp(attr(el, 'srcset')))) passive.push(el);
  }
  if (active.length) return r('fail', `Có ${active.length} mã lệnh/giao diện/khung nhúng tải qua http:// trên trang https (trình duyệt sẽ chặn).`, evList(doc, active));
  if (passive.length) return r('partial', `Có ${passive.length} ảnh/video/âm thanh tải qua http://.`, evList(doc, passive));
  return r('pass', 'Mọi tài nguyên đều tải qua https.', [evNote(WHOLE, 'Không có tài nguyên http://')]);
}

export function http_links(doc) {
  const bad = anchors(doc).filter((a) => /^http:\/\//i.test(href(a)));
  if (bad.length) return r('fail', `Có ${bad.length} liên kết trỏ tới địa chỉ http:// không bảo mật.`, evList(doc, bad));
  return r('pass', 'Không có liên kết nào trỏ tới http://.', [evNote(WHOLE, 'Không có liên kết http://')]);
}

export function meta_refresh(doc) {
  const m = tags(doc, 'meta').filter((x) => attrLower(x, 'http-equiv') === 'refresh');
  if (m.length) return r('fail', 'Trang tự chuyển hướng bằng meta refresh.', evList(doc, m));
  return r('pass', 'Không có meta refresh.', [evNote('Đã tìm trong phần đầu trang (<head>), không có meta refresh')]);
}

export function form_https_action(doc, ctx) {
  const forms = tags(doc, 'form');
  if (!forms.length) return r('pass', 'Trang không có form nào.', [evNote(WHOLE, 'Không có <form>')]);
  const pageHttp = /^http:/i.test(ctx.finalUrl);
  const bad = forms.filter((f) => {
    const a = norm(attr(f, 'action'));
    if (/^http:\/\//i.test(a)) return true;
    return pageHttp && !/^https:\/\//i.test(a);
  });
  if (bad.length) return r('fail', `Có ${bad.length} form gửi dữ liệu qua kết nối không bảo mật (http).`, evList(doc, bad));
  return r('pass', `Cả ${forms.length} form đều không gửi qua http://.`, evList(doc, forms));
}

export function inline_styles(doc) {
  const els = doc.all.filter((e) => attr(e, 'style') !== undefined);
  if (els.length <= 20) return r('pass', `Có ${els.length} phần tử viết style trực tiếp (tối đa 20).`, els.length ? evList(doc, els) : [evNote(WHOLE, '0 phần tử')]);
  return r('fail', `Có ${els.length} phần tử viết style trực tiếp, vượt mức 20.`, evList(doc, els));
}

// ---------- C. Di động & hình ảnh ----------
export function viewport(doc) {
  const m = tags(doc, 'meta').find((x) => attrLower(x, 'name') === 'viewport');
  if (!m) return r('fail', 'Không có thẻ viewport, trang trên điện thoại sẽ hiển thị rất nhỏ.', [evNote('Đã tìm trong phần đầu trang (<head>), không có meta viewport')]);
  if (attrLower(m, 'content').replace(/\s/g, '').includes('width=device-width')) return r('pass', 'Có thẻ viewport cho điện thoại.', [ev(doc, m)]);
  return r('partial', 'Có thẻ viewport nhưng thiếu width=device-width.', [ev(doc, m)]);
}

export function img_alt(doc) {
  const imgs = images(doc);
  if (!imgs.length) return r('pass', 'Trang không có ảnh nào.', [evNote(WHOLE, '0 ảnh')]);
  const bad = imgs.filter((i) => !norm(attr(i, 'alt')));
  const ratio = (imgs.length - bad.length) / imgs.length;
  const msg = `${imgs.length - bad.length}/${imgs.length} ảnh (${pct(ratio)}) có mô tả alt.`;
  const st = ratioStatus(ratio, 0.9, 0.5);
  return r(st, msg, bad.length ? evList(doc, bad, () => 'Thiếu alt') : evList(doc, imgs));
}

export function img_wh(doc) {
  const imgs = images(doc);
  if (!imgs.length) return r('pass', 'Trang không có ảnh nào.', [evNote(WHOLE, '0 ảnh')]);
  const bad = imgs.filter((i) => !norm(attr(i, 'width')) || !norm(attr(i, 'height')));
  const ratio = (imgs.length - bad.length) / imgs.length;
  return r(ratioStatus(ratio, 0.8), `${imgs.length - bad.length}/${imgs.length} ảnh (${pct(ratio)}) khai báo đủ width và height.`,
    bad.length ? evList(doc, bad, () => 'Thiếu width/height') : evList(doc, imgs));
}

export function favicon(doc, ctx) {
  const l = tags(doc, 'link').filter((x) => attrLower(x, 'rel').includes('icon'));
  if (l.length) return r('pass', 'Có khai báo biểu tượng tab.', evList(doc, l));
  if (ctx.faviconIcoExists) return r('pass', 'Có tệp /favicon.ico trên máy chủ.', [evNote(`File ${originOf(ctx)}/favicon.ico trên máy chủ`, 'Tồn tại')]);
  return r('fail', 'Không có biểu tượng tab (favicon).', [evNote(`Đã tìm thẻ <link rel="icon"> và file ${originOf(ctx)}/favicon.ico`, 'Không có')]);
}

export function theme_color(doc) {
  const m = tags(doc, 'meta').find((x) => attrLower(x, 'name') === 'theme-color');
  if (m) return r('pass', 'Có khai báo màu giao diện.', [ev(doc, m)]);
  return r('fail', 'Không khai báo màu giao diện (theme-color).', [evNote('Đã tìm trong phần đầu trang (<head>), không có meta theme-color')]);
}

export function lazy_load(doc) {
  const imgs = images(doc);
  if (imgs.length <= 3) return r('pass', `Trang chỉ có ${imgs.length} ảnh, không cần tải trễ.`, [evNote(WHOLE, `${imgs.length} ảnh`)]);
  const lazy = imgs.filter((i) => attrLower(i, 'loading') === 'lazy' || attr(i, 'data-src') !== undefined);
  const ratio = lazy.length / imgs.length;
  const msg = `${lazy.length}/${imgs.length} ảnh (${pct(ratio)}) được tải trễ.`;
  return r(ratioStatus(ratio, 0.5), msg, ratio >= 0.5 ? evList(doc, lazy) : evList(doc, imgs.filter((i) => !lazy.includes(i)), () => 'Không tải trễ'));
}

export function manifest(doc) {
  const l = tags(doc, 'link').find((x) => relTokens(x).includes('manifest'));
  if (l) return r('pass', 'Có khai báo manifest.', [ev(doc, l)]);
  return r('fail', 'Không khai báo manifest.', [evNote('Đã tìm trong phần đầu trang (<head>), không có <link rel="manifest">')]);
}

export function apple_icon(doc) {
  const l = tags(doc, 'link').find((x) => attrLower(x, 'rel').includes('apple-touch-icon'));
  if (l) return r('pass', 'Có biểu tượng cho iPhone/iPad.', [ev(doc, l)]);
  return r('fail', 'Không có biểu tượng apple-touch-icon.', [evNote('Đã tìm trong phần đầu trang (<head>), không có <link rel="apple-touch-icon">')]);
}

// ---------- D. Tốc độ tải nội dung ----------
export function resources(doc) {
  const js = tags(doc, 'script').filter((s) => norm(attr(s, 'src')));
  const css = tags(doc, 'link').filter((l) => relTokens(l).includes('stylesheet') && href(l));
  const n = js.length + css.length;
  const st = n <= 25 ? 'pass' : n <= 50 ? 'partial' : 'fail';
  return r(st, `Trang tải ${js.length} file JS và ${css.length} file CSS (tổng ${n}).`, [evNote(WHOLE, `${js.length} file JS, ${css.length} file CSS`)]);
}

export function page_weight(doc, ctx) {
  const b = ctx.sizeBytes;
  const st = b < 500 * 1024 ? 'pass' : b <= 1024 * 1024 ? 'partial' : 'fail';
  return r(st, `Mã HTML của trang nặng ${formatKB(b)}.`, [evNote(WHOLE, formatKB(b))]);
}

export function render_blocking(doc) {
  const head = tags(doc, 'head')[0];
  const scripts = tags(doc, 'script').filter((s) => norm(attr(s, 'src')) && (head ? hasAncestor(s, 'head') : getLocation(s).startsWith('Phần đầu')));
  const bad = scripts.filter((s) => attr(s, 'async') === undefined && attr(s, 'defer') === undefined && attrLower(s, 'type') !== 'module');
  const st = bad.length === 0 ? 'pass' : bad.length <= 3 ? 'partial' : 'fail';
  if (!bad.length) return r(st, 'Không có script nào trong <head> chặn hiển thị.', [evNote(HEAD, `${scripts.length} script đều có async/defer`)]);
  return r(st, `Có ${bad.length} script trong <head> thiếu async/defer, làm trang hiện chậm.`, evList(doc, bad, () => 'Thiếu async/defer'));
}

const MODERN = /\.(webp|avif)(?=$|[?#\s,])|[?&](fm|format)=(webp|avif)\b/i;
export function image_format(doc) {
  const imgs = images(doc);
  if (!imgs.length) return r('pass', 'Trang không có ảnh nào.', [evNote(WHOLE, '0 ảnh')]);
  const modern = imgs.filter((i) => {
    if (['src', 'srcset', 'data-src', 'data-srcset'].some((a) => MODERN.test(attr(i, a) || ''))) return true;
    const pic = i.parent && i.parent.tag === 'picture' ? i.parent : null;
    return !!pic && pic.children.some((s) => s.type === 'element' && s.tag === 'source' &&
      (/image\/(webp|avif)/i.test(attr(s, 'type') || '') || MODERN.test(attr(s, 'srcset') || '')));
  });
  const ratio = modern.length / imgs.length;
  const st = ratio >= 0.5 ? 'pass' : ratio > 0 ? 'partial' : 'fail';
  return r(st, `${modern.length}/${imgs.length} ảnh (${pct(ratio)}) dùng định dạng WebP/AVIF.`,
    st === 'pass' ? evList(doc, modern) : evList(doc, imgs.filter((i) => !modern.includes(i)), () => 'Chưa dùng WebP/AVIF'));
}

// ---------- E. Marketing & chuyển đổi ----------
const CTA_WORDS = ['liên hệ', 'đăng ký', 'mua ngay', 'nhận tư vấn', 'gọi ngay', 'đặt hàng', 'đặt lịch', 'báo giá', 'tư vấn'];
export function cta(doc) {
  const cands = doc.all.filter((e) => e.tag === 'a' || e.tag === 'button' || (e.tag === 'input' && ['submit', 'button'].includes(attrLower(e, 'type'))));
  const hits = cands.map((e) => ({ e, w: includesAny(lower(accessibleName(e)), CTA_WORDS) })).filter((x) => x.w);
  if (!hits.length) return r('fail', 'Không tìm thấy nút kêu gọi hành động (liên hệ, đăng ký, mua ngay…).', [evNote('Đã tìm mọi nút và liên kết trên trang', 'Không có từ khóa kêu gọi hành động')]);
  const words = [...new Set(hits.map((h) => h.w))];
  return r('pass', `Có ${hits.length} nút/liên kết kêu gọi hành động (từ khóa: ${words.join(', ')}).`, evList(doc, hits.map((h) => h.e), (el) => accessibleName(el)));
}

const PHONE_RE = /(?<!\d)(?:\+84|84|0)[235789](?:[\s.\-]?\d){8,9}(?!\d)/;
const HOTLINE_RE = /(?<!\d)1[89]00[\s.\-]?\d{3,4}(?:[\s.\-]?\d{1,4})?(?!\d)/;
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
export function contact_info(doc) {
  const as = anchors(doc);
  const kinds = [];
  const els = [];
  const add = (name, list) => { if (list.length) { kinds.push(name); els.push(list[0]); } };
  add('gọi điện (tel:)', as.filter((a) => /^tel:/i.test(href(a))));
  add('email (mailto:)', as.filter((a) => /^mailto:/i.test(href(a))));
  add('Zalo', as.filter((a) => /zalo\.me/i.test(href(a))));
  if (kinds.length) return r('pass', 'Có liên hệ bấm được: ' + kinds.join(', ') + '.', evList(doc, els));
  const text = visibleText(doc);
  const found = (text.match(PHONE_RE) || text.match(HOTLINE_RE) || text.match(EMAIL_RE) || [])[0];
  if (found) {
    return r('partial', `Trang có ghi thông tin liên hệ (${found}) nhưng chưa bấm được. Nên chuyển thành nút bấm gọi (tel:) hoặc gửi email (mailto:).`,
      [findTextEvidence(doc, found)]);
  }
  return r('fail', 'Không tìm thấy số điện thoại, email hay Zalo trên trang.', [evNote('Đã tìm mọi liên kết và chữ trên trang', 'Không có')]);
}
// tìm phần tử nhỏ nhất chứa đoạn chữ để chỉ vị trí bằng chứng
function findTextEvidence(doc, needle) {
  const n = lower(needle);
  let best = null;
  for (const el of doc.all) {
    if (['script', 'style', 'noscript', 'head', 'html', 'body'].includes(el.tag)) continue;
    if (lower(textOf(el, { visibleOnly: true })).includes(n)) best = el; // phần tử sau cùng là phần tử sâu nhất
  }
  return best ? ev(doc, best, needle) : evNote(BODY, needle);
}

function isSearchForm(f) {
  if (attrLower(f, 'role') === 'search') return true;
  if (/search|tim-kiem|timkiem/.test(attrLower(f, 'action'))) return true;
  const inputs = [];
  (function walk(n) { for (const c of n.children) if (c.type === 'element') { if (['input', 'textarea', 'select'].includes(c.tag)) inputs.push(c); walk(c); } })(f);
  if (inputs.some((i) => attrLower(i, 'type') === 'search')) return true;
  const visible = inputs.filter((i) => !['hidden', 'submit', 'button'].includes(attrLower(i, 'type')));
  return visible.length > 0 && visible.every((i) => ['q', 's', 'search', 'keyword', 'keywords', 'query'].includes(attrLower(i, 'name')));
}
function descendants(el, pred) {
  const out = [];
  (function walk(n) { for (const c of n.children) if (c.type === 'element') { if (pred(c)) out.push(c); walk(c); } })(el);
  return out;
}
export function contact_form(doc) {
  const forms = tags(doc, 'form').filter((f) => !isSearchForm(f));
  const good = forms.filter((f) => descendants(f, (c) => c.tag === 'textarea' || (c.tag === 'input' && ['email', 'tel'].includes(attrLower(c, 'type')))).length);
  if (good.length) return r('pass', `Có ${good.length} form liên hệ (có ô email/điện thoại/nội dung).`, evList(doc, good));
  if (forms.length) return r('partial', `Có ${forms.length} form nhưng không có ô email, điện thoại hay ô nhập nội dung.`, evList(doc, forms));
  return r('fail', 'Không có form liên hệ nào (không tính ô tìm kiếm).', [evNote('Đã tìm toàn trang', 'Không có <form> liên hệ')]);
}

const SOCIAL = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)zalo\.me$/, 'Zalo'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)linkedin\.com$/, 'LinkedIn'],
];
export function social_links(doc) {
  const found = new Map();
  for (const a of anchors(doc)) {
    const h = href(a);
    if (/sharer|\/share[?/]|intent\/tweet|shareArticle/i.test(h)) continue;
    let host;
    try { host = new URL(h, 'https://x.invalid').hostname.toLowerCase(); } catch { continue; }
    const s = SOCIAL.find(([re]) => re.test(host));
    if (s && !found.has(s[1])) found.set(s[1], a);
  }
  const names = [...found.keys()];
  const e = evList(doc, [...found.values()]);
  if (names.length >= 2) return r('pass', 'Tìm thấy liên kết: ' + names.join(', ') + '.', e);
  if (names.length === 1) return r('partial', `Chỉ có liên kết tới ${names[0]}, nên có thêm kênh khác.`, e);
  return r('fail', 'Không tìm thấy liên kết tới mạng xã hội (Facebook, Zalo, YouTube…).', [evNote('Đã tìm mọi liên kết trên trang', 'Không có')]);
}

const POLICY_WORDS = ['chính sách', 'điều khoản', 'bảo mật', 'đổi trả', 'privacy', 'policy', 'terms', 'chinh-sach', 'dieu-khoan', 'bao-mat', 'doi-tra'];
export function policy_links(doc) {
  const seen = new Map();
  for (const a of anchors(doc)) {
    const w = includesAny(lower(accessibleName(a)), POLICY_WORDS) || includesAny(href(a).toLowerCase(), POLICY_WORDS);
    if (w && href(a) && !seen.has(href(a))) seen.set(href(a), a);
  }
  const list = [...seen.values()];
  const names = list.slice(0, 5).map((a) => accessibleName(a) || href(a));
  if (list.length >= 2) return r('pass', `Có ${list.length} liên kết chính sách: ${names.join('; ')}.`, evList(doc, list));
  if (list.length === 1) return r('partial', `Chỉ có 1 liên kết chính sách: ${names[0]}.`, evList(doc, list));
  return r('fail', 'Không có liên kết tới trang chính sách, điều khoản hay đổi trả.', [evNote('Đã tìm mọi liên kết trên trang', 'Không có')]);
}

const PRODUCT_WORDS = ['sản phẩm', 'dịch vụ', 'bảng giá', 'product', 'service', 'cửa hàng', 'san-pham', 'dich-vu', 'bang-gia', 'cua-hang'];
export function product_service(doc) {
  const ldt = ldHas(doc, /^(Product|Service|Offer|ItemList|OfferCatalog|AggregateOffer)$/i);
  let signalEl = null, signal = '';
  if (ldt.length) signal = 'dữ liệu ' + ldt.join(', ');
  else {
    signalEl = doc.all.find((e) => (e.tag === 'a' || /^h[1-6]$/.test(e.tag)) &&
      (includesAny(lower(accessibleName(e)), PRODUCT_WORDS) || (e.tag === 'a' && includesAny(href(e).toLowerCase(), PRODUCT_WORDS))));
    if (signalEl) signal = `"${accessibleName(signalEl) || href(signalEl)}"`;
  }
  const words = visibleText(doc).split(' ').filter(Boolean).length;
  const c1 = !!signal, c2 = words >= 300;
  const e = [];
  if (ldt.length) e.push(ldEvidence(doc, ldt.join(', ')));
  else if (signalEl) e.push(ev(doc, signalEl));
  e.push(evNote(BODY, `${words} chữ`));
  const parts = `${c1 ? 'Có mục ' + signal : 'Không có mục sản phẩm/dịch vụ'}; nội dung trang có ${words} chữ (${c2 ? 'đủ' : 'chưa đủ'} 300).`;
  return r(c1 && c2 ? 'pass' : c1 || c2 ? 'partial' : 'fail', parts, e);
}

export function site_search(doc) {
  const el = doc.all.find((e) => (e.tag === 'input' && (attrLower(e, 'type') === 'search' || ['q', 's', 'search', 'keyword', 'keywords', 'query'].includes(attrLower(e, 'name')))) ||
    attrLower(e, 'role') === 'search');
  if (el) return r('pass', 'Có ô tìm kiếm trên trang.', [ev(doc, el)]);
  return r('fail', 'Không có ô tìm kiếm.', [evNote('Đã tìm toàn trang', 'Không có ô tìm kiếm')]);
}

const MAP_RE = /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl/i;
export function map_embed(doc) {
  const el = doc.all.find((e) => (e.tag === 'iframe' && MAP_RE.test(attr(e, 'src') || '')) || (e.tag === 'a' && MAP_RE.test(href(e))));
  if (el) return r('pass', el.tag === 'iframe' ? 'Có nhúng bản đồ Google Maps.' : 'Có liên kết chỉ đường Google Maps.', [ev(doc, el)]);
  return r('fail', 'Không có bản đồ hay liên kết chỉ đường.', [evNote('Đã tìm khung nhúng và liên kết trên trang', 'Không có Google Maps')]);
}

// ---------- F. Tin cậy & minh bạch ----------
export function trust_signals(doc) {
  const ldt = ldHas(doc, /^(Review|AggregateRating)$/i);
  const hasRatingProp = ldBlocks(doc).objects.some((o) => o.aggregateRating || o.review);
  if (ldt.length || hasRatingProp) return r('pass', 'Có dữ liệu đánh giá của khách hàng.', [ldEvidence(doc, ldt.join(', ') || 'aggregateRating/review')]);
  const block = doc.all.find((e) => ['class', 'id'].some((a) => /review|testimonial/.test(attrLower(e, a))));
  if (block) return r('pass', 'Có khối nhận xét/đánh giá của khách hàng.', [ev(doc, block)]);
  const bct = anchors(doc).find((a) => /online\.gov\.vn/i.test(href(a)));
  if (bct) return r('pass', 'Có logo đã thông báo/đăng ký với Bộ Công Thương.', [ev(doc, bct)]);
  const w = includesAny(visibleText(doc), ['đánh giá', 'nhận xét', 'khách hàng nói']);
  if (w) return r('partial', `Trang có nhắc tới "${w}" nhưng chưa có khối đánh giá khách hàng rõ ràng.`, [findTextEvidence(doc, w)]);
  return r('fail', 'Không tìm thấy đánh giá khách hàng hay dấu hiệu tạo niềm tin.', [evNote('Đã tìm toàn trang', 'Không có')]);
}

export function business_identity(doc) {
  const org = ldBlocks(doc).objects.find((o) => {
    const t = [].concat(o['@type'] || []).join(' ');
    return /Organization|LocalBusiness|Corporation|Store|Business|Restaurant/i.test(t) && o.name && o.address;
  });
  if (org) return r('pass', `Có dữ liệu doanh nghiệp: ${org.name}.`, [ldEvidence(doc, String(org.name))]);
  const text = visibleText(doc);
  const cats = [
    ['tên doanh nghiệp', ['công ty', 'tnhh', 'cổ phần', 'hộ kinh doanh']],
    ['địa chỉ', ['địa chỉ', 'phường', 'quận', 'thành phố', 'tỉnh']],
    ['mã số doanh nghiệp', ['mã số thuế', 'msdn', 'mã số doanh nghiệp', 'giấy phép kinh doanh', 'gpkd', /\bmst\b/]],
  ].map(([name, words]) => {
    const hit = words.find((w) => (w instanceof RegExp ? w.test(text) : text.includes(w)));
    return { name, hit: hit instanceof RegExp ? 'mst' : hit };
  });
  const have = cats.filter((c) => c.hit);
  const e = have.slice(0, 3).map((c) => findTextEvidence(doc, c.hit));
  if (have.length === 3) return r('pass', 'Có đủ tên doanh nghiệp, địa chỉ và mã số doanh nghiệp.', e);
  if (have.length) return r('partial', `Có ${have.map((c) => c.name).join(', ')}; còn thiếu ${cats.filter((c) => !c.hit).map((c) => c.name).join(', ')}.`, e);
  return r('fail', 'Không có thông tin nhận diện doanh nghiệp (tên, địa chỉ, mã số).', [evNote('Đã tìm toàn bộ chữ trên trang', 'Không có')]);
}

const SUPPORT_WORDS = ['faq', 'hỏi đáp', 'câu hỏi thường gặp', 'hỗ trợ', 'trợ giúp', 'help', 'support', 'hoi-dap', 'ho-tro', 'tro-giup', 'cau-hoi'];
export function support_info(doc) {
  if (ldHas(doc, /^FAQPage$/i).length) return r('pass', 'Có dữ liệu hỏi đáp (FAQPage).', [ldEvidence(doc, 'FAQPage')]);
  const a = anchors(doc).find((x) => includesAny(lower(accessibleName(x)), SUPPORT_WORDS) || includesAny(href(x).toLowerCase(), SUPPORT_WORDS));
  if (a) return r('pass', `Có liên kết hỗ trợ: "${accessibleName(a) || href(a)}".`, [ev(doc, a)]);
  return r('fail', 'Không có liên kết tới trang hỗ trợ hay câu hỏi thường gặp.', [evNote('Đã tìm mọi liên kết trên trang', 'Không có')]);
}

const HOURS_RE = /(?<!\d)\d{1,2}\s*(?:h|:|giờ)\s*\d{0,2}\s*(?:-|–|—|đến|tới)\s*\d{1,2}\s*(?:h|:|giờ)\s*\d{0,2}/;
export function working_hours(doc) {
  const ldo = ldBlocks(doc).objects.find((o) => o.openingHours || o.openingHoursSpecification);
  if (ldo) return r('pass', 'Có dữ liệu giờ mở cửa (openingHours).', [ldEvidence(doc, 'openingHours')]);
  const text = visibleText(doc);
  const w = includesAny(text, ['giờ mở cửa', 'giờ làm việc', 'thời gian làm việc']) || (text.match(HOURS_RE) || [])[0];
  if (w) return r('pass', `Có thông tin giờ làm việc ("${w}").`, [findTextEvidence(doc, w)]);
  return r('fail', 'Không có thông tin giờ mở cửa/làm việc.', [evNote('Đã tìm toàn bộ chữ trên trang', 'Không có')]);
}

// ---------- G. Trải nghiệm & truy cập ----------
export function semantic_html(doc) {
  const parts = ['header', 'nav', 'main', 'footer'];
  const have = parts.filter((p) => tags(doc, p).length);
  const missing = parts.filter((p) => !have.includes(p));
  const st = have.length === 4 ? 'pass' : have.length >= 2 ? 'partial' : 'fail';
  const e = have.length ? evList(doc, have.map((p) => tags(doc, p)[0])) : [evNote('Đã tìm toàn trang', 'Không có header, nav, main, footer')];
  return r(st, `Có ${have.length}/4 phần bố cục${have.length ? ' (' + have.join(', ') + ')' : ''}${missing.length ? '; thiếu ' + missing.join(', ') : ''}.`, e);
}

function visibleInputs(doc) {
  return doc.all.filter((e) => (e.tag === 'input' && !['hidden', 'submit', 'button', 'reset', 'image'].includes(attrLower(e, 'type'))) || e.tag === 'select' || e.tag === 'textarea');
}
export function form_labels(doc) {
  const inputs = visibleInputs(doc);
  if (!inputs.length) return r('pass', 'Trang không có ô nhập nào.', [evNote(WHOLE, '0 ô nhập')]);
  const forIds = new Set(tags(doc, 'label').map((l) => norm(attr(l, 'for'))).filter(Boolean));
  const labelled = (i) => (norm(attr(i, 'id')) && forIds.has(norm(attr(i, 'id')))) || hasAncestor(i, 'label') ||
    ['aria-label', 'aria-labelledby', 'title'].some((a) => norm(attr(i, a)));
  const bad = inputs.filter((i) => !labelled(i));
  const ratio = (inputs.length - bad.length) / inputs.length;
  return r(ratioStatus(ratio, 0.9, 0.5), `${inputs.length - bad.length}/${inputs.length} ô nhập (${pct(ratio)}) có nhãn.`,
    bad.length ? evList(doc, bad, () => 'Thiếu nhãn') : evList(doc, inputs));
}

export function accessible_names(doc) {
  const els = tags(doc, 'a', 'button');
  if (!els.length) return r('pass', 'Trang không có liên kết hay nút nào.', [evNote(WHOLE, '0')]);
  const bad = els.filter((e) => !accessibleName(e));
  const ratio = (els.length - bad.length) / els.length;
  return r(ratioStatus(ratio, 0.9, 0.7), `${els.length - bad.length}/${els.length} liên kết và nút (${pct(ratio)}) có tên.`,
    bad.length ? evList(doc, bad, () => 'Không có tên') : [evNote(BODY, `${els.length} liên kết/nút đều có tên`)]);
}

export function blank_links(doc) {
  const blank = anchors(doc).filter((a) => attrLower(a, 'target') === '_blank');
  const bad = blank.filter((a) => !relTokens(a).some((t) => t === 'noopener' || t === 'noreferrer'));
  if (bad.length) return r('fail', `Có ${bad.length}/${blank.length} liên kết mở tab mới thiếu rel="noopener".`, evList(doc, bad, () => 'Thiếu rel noopener'));
  return r('pass', blank.length ? `Cả ${blank.length} liên kết mở tab mới đều có rel bảo mật.` : 'Không có liên kết mở tab mới.',
    blank.length ? evList(doc, blank) : [evNote(WHOLE, 'Không có target="_blank"')]);
}

export function skip_link(doc) {
  const a = anchors(doc).find((x) => href(x).startsWith('#') &&
    includesAny(lower(textOf(x) + ' ' + (attr(x, 'aria-label') || '')), ['skip', 'bỏ qua', 'nội dung chính', 'chuyển đến nội dung']));
  if (a) return r('pass', 'Có liên kết nhảy tới nội dung chính.', [ev(doc, a)]);
  return r('fail', 'Không có liên kết "Bỏ qua tới nội dung chính".', [evNote('Đã tìm mọi liên kết "#…" trên trang', 'Không có')]);
}

export function iframe_title(doc) {
  const fr = tags(doc, 'iframe');
  if (!fr.length) return r('pass', 'Trang không có khung nhúng (iframe).', [evNote(WHOLE, '0 iframe')]);
  const bad = fr.filter((f) => !norm(attr(f, 'title')));
  if (bad.length) return r('fail', `Có ${bad.length}/${fr.length} khung nhúng thiếu title.`, evList(doc, bad, () => 'Thiếu title'));
  return r('pass', `Cả ${fr.length} khung nhúng đều có title.`, evList(doc, fr));
}

function dataTables(doc) {
  return tags(doc, 'table').filter((t) => !['presentation', 'none'].includes(attrLower(t, 'role')));
}
export function table_headers(doc) {
  const ts = dataTables(doc);
  if (!ts.length) return r('pass', 'Trang không có bảng dữ liệu.', [evNote(WHOLE, '0 bảng')]);
  const bad = ts.filter((t) => !descendants(t, (c) => c.tag === 'th').length);
  if (bad.length) return r('fail', `Có ${bad.length}/${ts.length} bảng không có ô tiêu đề <th>.`, evList(doc, bad, () => 'Thiếu <th>'));
  return r('pass', `Cả ${ts.length} bảng đều có ô tiêu đề.`, evList(doc, ts));
}
export function table_caption(doc) {
  const ts = dataTables(doc);
  if (!ts.length) return r('pass', 'Trang không có bảng dữ liệu.', [evNote(WHOLE, '0 bảng')]);
  const bad = ts.filter((t) => !t.children.some((c) => c.type === 'element' && c.tag === 'caption') && !norm(attr(t, 'aria-label')) && !norm(attr(t, 'aria-labelledby')));
  if (bad.length) return r('fail', `Có ${bad.length}/${ts.length} bảng không có tiêu đề bảng.`, evList(doc, bad, () => 'Thiếu <caption>'));
  return r('pass', `Cả ${ts.length} bảng đều có tiêu đề.`, evList(doc, ts));
}

export function input_autocomplete(doc) {
  const personal = tags(doc, 'input').filter((i) => {
    const t = attrLower(i, 'type');
    if (['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'search', 'password'].includes(t)) return false;
    if (t === 'email' || t === 'tel') return true;
    const n = attrLower(i, 'name') + ' ' + attrLower(i, 'id');
    return /email|phone|tel|name|hoten|address|diachi/.test(n);
  });
  if (!personal.length) return r('pass', 'Trang không có ô nhập thông tin cá nhân.', [evNote(WHOLE, '0 ô')]);
  const bad = personal.filter((i) => !attrLower(i, 'autocomplete') || attrLower(i, 'autocomplete') === 'off');
  if (bad.length) return r('fail', `Có ${bad.length}/${personal.length} ô thông tin cá nhân thiếu autocomplete.`, evList(doc, bad, () => 'Thiếu autocomplete'));
  return r('pass', `Cả ${personal.length} ô thông tin cá nhân đều có autocomplete.`, evList(doc, personal));
}

export function form_fieldset(doc) {
  const groups = new Map();
  for (const i of tags(doc, 'input')) {
    const t = attrLower(i, 'type');
    if (t !== 'radio' && t !== 'checkbox') continue;
    const name = norm(attr(i, 'name'));
    if (!name) continue;
    const form = closest(i, (p) => p.tag === 'form');
    const key = (form ? form.start : 'doc') + '|' + name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const real = [...groups.values()].filter((g) => g.length >= 2);
  if (!real.length) return r('pass', 'Trang không có nhóm lựa chọn (radio/checkbox).', [evNote(WHOLE, '0 nhóm')]);
  const ok = (i) => {
    const fs = closest(i, (p) => p.tag === 'fieldset');
    if (fs && fs.children.some((c) => c.type === 'element' && c.tag === 'legend')) return true;
    const g = closest(i, (p) => ['radiogroup', 'group'].includes(attrLower(p, 'role')));
    return !!g && (norm(attr(g, 'aria-label')) || norm(attr(g, 'aria-labelledby')));
  };
  const bad = real.filter((g) => !ok(g[0]));
  if (bad.length) return r('fail', `Có ${bad.length}/${real.length} nhóm lựa chọn chưa nằm trong fieldset có legend.`, evList(doc, bad.map((g) => g[0]), () => 'Thiếu fieldset/legend'));
  return r('pass', `Cả ${real.length} nhóm lựa chọn đều có fieldset/legend.`, evList(doc, real.map((g) => g[0])));
}

export function media_autoplay(doc) {
  const bad = doc.all.filter((e) => {
    if (e.tag === 'audio') return attr(e, 'autoplay') !== undefined;
    if (e.tag === 'video') return attr(e, 'autoplay') !== undefined && attr(e, 'muted') === undefined;
    if (e.tag === 'iframe') {
      const s = attr(e, 'src') || '';
      return /youtube(-nocookie)?\.com|youtu\.be/i.test(s) && /[?&]autoplay=1/i.test(s) && !/[?&]mute=1/i.test(s);
    }
    return false;
  });
  if (bad.length) return r('fail', `Có ${bad.length} video/âm thanh tự phát có tiếng.`, evList(doc, bad));
  return r('pass', 'Không có video/âm thanh tự phát có tiếng.', [evNote(WHOLE, 'Không có')]);
}
