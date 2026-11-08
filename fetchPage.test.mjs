import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPage, normalizeUrl, isPrivateIp, MESSAGES } from '../lib/fetchPage.mjs';
import { analyzeUrl } from '../lib/score.mjs';

let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const u = req.url;
    if (u === '/') { res.writeHead(301, { Location: '/home' }); return res.end(); }
    if (u === '/home') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<html lang="vi"><head><title>Trang chủ thử nghiệm</title></head><body><h1>Xin chào</h1></body></html>'); }
    if (u === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nSitemap: /sm.xml'); }
    if (u === '/sm.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end('<urlset><url><loc>/</loc><lastmod>2026-01-01</lastmod></url></urlset>'); }
    if (u === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/x-icon' }); return res.end(req.method === 'HEAD' ? undefined : 'ico'); }
    if (u === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>' + 'a'.repeat(2.5 * 1024 * 1024)); }
    if (u === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF'); }
    if (u === '/slow') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); }, 12000); return; }
    if (u === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const local = { allowPrivate: true };

test('chuẩn hóa URL: tự thêm https://, từ chối URL sai', () => {
  assert.equal(normalizeUrl('  tenmien.vn '), 'https://tenmien.vn/');
  assert.equal(normalizeUrl('http://abc.com/x#y'), 'http://abc.com/x');
  assert.throws(() => normalizeUrl(''), { message: MESSAGES.invalid });
  assert.throws(() => normalizeUrl('ftp://abc.com'), { message: MESSAGES.invalid });
  assert.throws(() => normalizeUrl('khong co dau cham'), { message: MESSAGES.invalid });
});

test('nhận diện địa chỉ nội bộ', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});

test('chặn SSRF: localhost và 192.168.1.1', async () => {
  await assert.rejects(fetchPage('localhost:3000'), { message: MESSAGES.private });
  await assert.rejects(fetchPage('http://192.168.1.1/admin'), { message: MESSAGES.private });
  await assert.rejects(fetchPage('http://[::1]/'), { message: MESSAGES.private });
});

test('chặn SSRF cả khi tên miền trỏ về IP nội bộ', async () => {
  const lookup = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(fetchPage('https://noi-bo.example.com', { lookup }), { message: MESSAGES.private });
});

test('theo chuyển hướng, lưu finalUrl, tải robots.txt, sitemap, favicon', async () => {
  const ctx = await fetchPage(base + '/', local);
  assert.equal(ctx.finalUrl, base + '/home');
  assert.match(ctx.html, /Xin chào/);
  assert.ok(ctx.sizeBytes > 50);
  assert.ok(ctx.responseTimeMs >= 0);
  assert.equal(ctx.robotsTxt.status, 200);
  assert.equal(ctx.sitemap.url, base + '/sm.xml');
  assert.equal(ctx.faviconIcoExists, true);
});

test('analyzeUrl trả kết quả đầy đủ 60 hạng mục', async () => {
  const res = await analyzeUrl(base + '/', local);
  assert.equal(res.checks.length, 60);
  assert.equal(res.groups.length, 7);
  assert.match(res.checkedAt, /\+07:00$/);
  assert.equal(res.checks.find((c) => c.key === 'sitemap_lastmod').status, 'pass');
  assert.equal(res.checks.find((c) => c.key === 'favicon').status, 'pass');
});

test('trang quá 2 MB, không phải HTML, lỗi 404, chuyển hướng vòng lặp', async () => {
  await assert.rejects(fetchPage(base + '/big', local), { message: MESSAGES.tooLarge });
  await assert.rejects(fetchPage(base + '/pdf', local), { message: MESSAGES.notHtml });
  await assert.rejects(fetchPage(base + '/khong-co', local), /máy chủ trả về mã lỗi 404/);
  await assert.rejects(fetchPage(base + '/loop', local), /chuyển hướng quá nhiều lần/);
});

test('website phản hồi quá 10 giây', { timeout: 20000 }, async () => {
  await assert.rejects(fetchPage(base + '/slow', local), { message: MESSAGES.timeout });
});
