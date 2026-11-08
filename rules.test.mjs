import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreHtml } from '../lib/score.mjs';
import { CRITERIA, GROUPS } from '../lib/criteria.mjs';
import * as RULES from '../lib/rules.mjs';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const baseCtx = {
  finalUrl: 'https://example.com/', responseTimeMs: 800, sizeBytes: 50000, faviconIcoExists: false,
  robotsTxt: null, sitemap: null,
};
const passCtx = {
  ...baseCtx,
  robotsTxt: { status: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml' },
  sitemap: { url: 'https://example.com/sitemap.xml', status: 200, body: '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc><lastmod>2026-11-01</lastmod></url></urlset>' },
};
const failCtx = { finalUrl: 'http://example.com/', responseTimeMs: 5000, sizeBytes: 1500000, faviconIcoExists: false, robotsTxt: null, sitemap: null };

const run = (html, ctx = baseCtx) => scoreHtml(html, ctx);
const check = (res, key) => res.checks.find((c) => c.key === key);

// ---------- cấu trúc bộ tiêu chí ----------
test('đủ 60 tiêu chí, không trùng mã, mỗi tiêu chí có hàm chấm', () => {
  assert.equal(CRITERIA.length, 60);
  assert.equal(new Set(CRITERIA.map((c) => c.key)).size, 60);
  for (const c of CRITERIA) {
    assert.equal(typeof RULES[c.key], 'function', `thiếu hàm chấm cho ${c.key}`);
    assert.ok(c.description && c.howScored && c.fix, `thiếu nội dung cho ${c.key}`);
  }
});

test('tổng điểm tối đa = 100 và đúng điểm từng nhóm', () => {
  const expected = { A: [12, 22], B: [13, 19], C: [8, 12], D: [4, 8], E: [8, 17], F: [4, 7], G: [11, 15] };
  assert.equal(CRITERIA.reduce((s, c) => s + c.max, 0), 100);
  for (const g of GROUPS) {
    const items = CRITERIA.filter((c) => c.group === g.key);
    assert.deepEqual([items.length, items.reduce((s, c) => s + c.max, 0)], expected[g.key], `nhóm ${g.key}`);
  }
});

// ---------- trang đạt hết / trượt hết ----------
test('all-pass.html được đúng 100 điểm', () => {
  const res = run(fx('all-pass.html'), passCtx);
  const notPass = res.checks.filter((c) => c.status !== 'pass').map((c) => `${c.key}: ${c.detail}`);
  assert.deepEqual(notPass, []);
  assert.equal(res.score, 100);
  assert.equal(res.grade, 'Xuất sắc');
});

test('all-fail.html được đúng 0 điểm', () => {
  const res = run(fx('all-fail.html'), failCtx);
  const scored = res.checks.filter((c) => c.points > 0).map((c) => `${c.key}: ${c.detail}`);
  assert.deepEqual(scored, []);
  assert.equal(res.score, 0);
  assert.equal(res.grade, 'Cần cải thiện gấp');
});

test('tổng điểm 7 nhóm luôn bằng điểm tổng', () => {
  for (const [f, ctx] of [['all-pass.html', passCtx], ['all-fail.html', failCtx], ['contact-text-only.html', baseCtx]]) {
    const res = run(fx(f), ctx);
    assert.equal(res.groups.reduce((s, g) => s + g.points, 0), res.score);
    assert.equal(res.groups.reduce((s, g) => s + g.max, 0), 100);
  }
});

test('mọi tiêu chí luôn có bằng chứng với vị trí, đoạn mã không quá 160 ký tự', () => {
  for (const [f, ctx] of [['all-pass.html', passCtx], ['all-fail.html', failCtx], ['two-h1.html', baseCtx]]) {
    for (const c of run(fx(f), ctx).checks) {
      assert.ok(c.evidence.length >= 1 && c.evidence.length <= 3, `${f} ${c.key} số bằng chứng`);
      for (const e of c.evidence) {
        assert.ok(e.location && e.location.length > 0, `${f} ${c.key} thiếu vị trí`);
        if (e.snippet) assert.ok(Array.from(e.snippet).length <= 160, `${f} ${c.key} đoạn mã quá dài`);
      }
      if (c.status !== 'pass') assert.ok(c.fix, `${f} ${c.key} thiếu cách khắc phục`);
      else assert.equal(c.fix, undefined);
    }
  }
});

test('chấm điểm cố định: chạy 2 lần cho cùng kết quả', () => {
  assert.deepEqual(run(fx('all-pass.html'), passCtx), run(fx('all-pass.html'), passCtx));
});

// ---------- từng trường hợp ----------
test('two-h1: H1 đạt một phần, 2 bằng chứng có số dòng và thẻ <h1', () => {
  const c = check(run(fx('two-h1.html')), 'h1');
  assert.equal(c.status, 'partial');
  assert.equal(c.points, 1);
  assert.equal(c.evidence.length, 2);
  assert.deepEqual(c.evidence.map((e) => e.line), [2, 4]);
  for (const e of c.evidence) assert.ok(e.snippet.startsWith('<h1'));
});

test('long-title: tiêu đề 75+ ký tự có dấu → đạt một phần', () => {
  const c = check(run(fx('long-title.html')), 'title');
  assert.equal(c.status, 'partial');
  assert.equal(c.points, 1);
  assert.match(c.detail, /vượt mức 60/);
});

test('missing-alt: 6/10 ảnh có alt → đạt một phần, liệt kê đúng ảnh thiếu alt', () => {
  const c = check(run(fx('missing-alt.html')), 'img_alt');
  assert.equal(c.status, 'partial');
  assert.equal(c.points, 1);
  assert.match(c.detail, /6\/10/);
  assert.deepEqual(c.evidence.map((e) => /src="([^"]+)"/.exec(e.snippet)[1]), ['/thieu-alt-6.jpg', '/thieu-alt-7.jpg', '/thieu-alt-8.jpg']);
});

test('gtm: nhận diện Google Tag Manager', () => {
  const c = check(run(fx('gtm.html')), 'analytics');
  assert.equal(c.status, 'pass');
  assert.match(c.detail, /Google Tag Manager/);
  assert.equal(c.evidence[0].location, 'Phần đầu trang (<head>, khách không nhìn thấy)');
});

test('tel-zalo: liên hệ bấm được → đạt, bằng chứng ở chân trang; social 1 nền tảng → một phần', () => {
  const res = run(fx('tel-zalo.html'));
  const c = check(res, 'contact_info');
  assert.equal(c.status, 'pass');
  assert.match(c.detail, /gọi điện.*Zalo/);
  assert.equal(c.evidence[0].location, 'Chân trang');
  assert.equal(check(res, 'social_links').status, 'partial');
  assert.equal(check(res, 'cta').status, 'pass');
});

test('noindex (viết hoa) → robots_meta chưa đạt', () => {
  assert.equal(check(run(fx('noindex.html')), 'robots_meta').status, 'fail');
});

test('uppercase: thẻ và thuộc tính viết HOA vẫn được nhận', () => {
  const res = run(fx('uppercase.html'));
  assert.equal(check(res, 'meta_description').status, 'pass');
  assert.equal(check(res, 'favicon').status, 'pass');
  assert.equal(check(res, 'lang').status, 'pass');
  assert.equal(check(res, 'charset').status, 'pass');
  assert.equal(check(res, 'title').status, 'pass');
});

test('og-name: thẻ Open Graph dùng name thay property vẫn được nhận', () => {
  assert.equal(check(run(fx('og-name.html')), 'open_graph').status, 'pass');
});

test('contact-text-only: số điện thoại dạng chữ → một phần, không nhận nhầm MSDN', () => {
  const res = run(fx('contact-text-only.html'));
  const c = check(res, 'contact_info');
  assert.equal(c.status, 'partial');
  assert.equal(c.points, 1);
  assert.match(c.detail, /02839369142/);
  assert.equal(c.evidence[0].location, 'Chân trang');
  assert.equal(check(res, 'business_identity').status, 'partial');
});

test('tax-code-only: chỉ có mã số doanh nghiệp → không tính là số điện thoại', () => {
  assert.equal(check(run(fx('tax-code-only.html')), 'contact_info').status, 'fail');
});

test('mixed-content: script http trên trang https → chưa đạt; chỉ ảnh http → một phần', () => {
  assert.equal(check(run(fx('mixed-content.html')), 'mixed_content').status, 'fail');
  assert.equal(check(run(fx('mixed-passive.html')), 'mixed_content').status, 'partial');
});

test('forms-tables: thiếu nhãn, fieldset, th, caption, rel, title iframe, autocomplete', () => {
  const res = run(fx('forms-tables.html'));
  for (const k of ['form_labels', 'form_fieldset', 'table_headers', 'table_caption', 'blank_links', 'iframe_title', 'input_autocomplete']) {
    assert.equal(check(res, k).status, 'fail', k);
  }
  assert.equal(check(res, 'contact_form').status, 'pass');
});

test('robots.txt chặn toàn bộ → một phần; không có → chưa đạt', () => {
  const html = fx('two-h1.html');
  assert.equal(check(run(html, { ...baseCtx, robotsTxt: { status: 200, body: 'User-agent: *\nDisallow: /' } }), 'robots_txt').status, 'partial');
  assert.equal(check(run(html, { ...baseCtx, robotsTxt: { status: 200, body: 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin' } }), 'robots_txt').status, 'pass');
  assert.equal(check(run(html, baseCtx), 'robots_txt').status, 'fail');
});

test('sitemap sai định dạng → một phần; sitemap không có lastmod', () => {
  const html = fx('two-h1.html');
  const res = run(html, { ...baseCtx, sitemap: { url: 'https://example.com/sitemap.xml', status: 200, body: '<html>not found</html>' } });
  assert.equal(check(res, 'sitemap').status, 'partial');
  assert.equal(check(res, 'sitemap_lastmod').status, 'fail');
});

test('dung lượng HTML: dưới 500KB đạt, 500KB–1MB một phần', () => {
  const html = fx('two-h1.html');
  assert.equal(check(run(html, { ...baseCtx, sizeBytes: 400 * 1024 }), 'page_weight').status, 'pass');
  assert.equal(check(run(html, { ...baseCtx, sizeBytes: 700 * 1024 }), 'page_weight').status, 'partial');
  assert.equal(check(run(html, { ...baseCtx, sizeBytes: 2 * 1024 * 1024 }), 'page_weight').status, 'fail');
});

test('tiêu chí 1 điểm không bao giờ có trạng thái đạt một phần', () => {
  for (const f of ['all-pass.html', 'all-fail.html', 'forms-tables.html', 'contact-text-only.html']) {
    for (const c of run(fx(f)).checks) if (c.max === 1) assert.notEqual(c.status, 'partial', `${f} ${c.key}`);
  }
});
