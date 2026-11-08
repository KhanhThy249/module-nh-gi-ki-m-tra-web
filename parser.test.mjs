import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDoc, tags, getLine, getLocation, getSnippet, visibleText, textOf } from '../lib/dom.mjs';

const html = `<!doctype html>
<html lang="vi">
<head>
<title>Tiêu đề &amp; mô tả</title>
<script>var x = "<div>không phải thẻ</div>";</script>
</head>
<body>
<header><nav><a href="/">Trang chủ</a></nav></header>
<main><p>Đoạn một<p>Đoạn hai <b>đậm</b></main>
<footer><p>Chân trang</p></footer>
<noscript><img src="/pixel.gif"></noscript>
</body>
</html>`;

test('đọc số dòng và vị trí của phần tử', () => {
  const doc = loadDoc(html);
  assert.equal(getLine(tags(doc, 'title')[0]), 4);
  assert.equal(getLocation(tags(doc, 'title')[0]), 'Phần đầu trang (<head>, khách không nhìn thấy)');
  assert.equal(getLocation(tags(doc, 'a')[0]), 'Đầu trang / thanh menu');
  assert.equal(getLocation(tags(doc, 'p')[0]), 'Nội dung chính của trang');
  assert.equal(getLocation(tags(doc, 'p')[2]), 'Chân trang');
  assert.equal(getLocation(tags(doc, 'html')[0]), 'Thẻ mở đầu của trang (<html>)');
  assert.equal(getLine(tags(doc, 'footer')[0]), 10);
});

test('chữ trong script không bị đọc thành thẻ; noscript không tạo ảnh', () => {
  const doc = loadDoc(html);
  assert.equal(tags(doc, 'div').length, 0);
  assert.equal(tags(doc, 'img').length, 0);
});

test('giải mã ký tự HTML và đóng thẻ p ngầm định', () => {
  const doc = loadDoc(html);
  assert.equal(textOf(tags(doc, 'title')[0]), 'Tiêu đề & mô tả');
  assert.equal(tags(doc, 'p').length, 3);
  assert.equal(textOf(tags(doc, 'p')[0]), 'Đoạn một');
});

test('chữ hiển thị bỏ script/noscript, chữ thường', () => {
  const t = visibleText(loadDoc(html));
  assert.ok(t.includes('đoạn hai đậm'));
  assert.ok(!t.includes('không phải thẻ'));
  assert.ok(!t.includes('tiêu đề'));
});

test('đoạn mã được cắt tối đa 160 ký tự kèm dấu …', () => {
  const long = `<p class="${'x'.repeat(300)}">a</p>`;
  const doc = loadDoc(long);
  const s = getSnippet(doc, tags(doc, 'p')[0]);
  assert.equal(Array.from(s).length, 160);
  assert.ok(s.endsWith('…'));
});

test('thuộc tính có dấu > trong nháy và thẻ viết hoa', () => {
  const doc = loadDoc('<IMG ALT="a > b" SRC="/x.jpg"><Input Type=Email>');
  assert.equal(tags(doc, 'img')[0].attrs.alt, 'a > b');
  assert.equal(tags(doc, 'input')[0].attrs.type, 'Email');
});
