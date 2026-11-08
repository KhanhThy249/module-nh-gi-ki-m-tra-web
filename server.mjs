// Máy chủ nhỏ: phục vụ giao diện và API chấm điểm. Không cần cài thêm thư viện.
// Chạy: node server.mjs   (hoặc npm start)   → mở http://localhost:3002
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzeUrl } from './lib/score.mjs';
import { CRITERIA, GROUPS } from './lib/criteria.mjs';
import { AuditError } from './lib/fetchPage.mjs';

const PORT = Number(process.env.PORT) || 3002;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req, limit = 10 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new AuditError('Yêu cầu quá lớn');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new AuditError('Dữ liệu gửi lên không hợp lệ'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      const data = await readFile(path.join(ROOT, file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(data);
    }
    if (req.method === 'GET' && url.pathname === '/api/criteria') {
      return sendJson(res, 200, { groups: GROUPS, criteria: CRITERIA });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const { url: target } = await readJson(req);
      const started = Date.now();
      const result = await analyzeUrl(target);
      console.log(`[kiểm tra] ${result.finalUrl} → ${result.score}/100 (${Date.now() - started} ms)`);
      return sendJson(res, 200, result);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Không tìm thấy');
  } catch (e) {
    if (e instanceof AuditError) return sendJson(res, 400, { error: e.message });
    console.error(e);
    return sendJson(res, 500, { error: 'Đã xảy ra lỗi không mong muốn khi kiểm tra website.' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nCổng ${PORT} đang được chương trình khác dùng.`);
    console.error(`Hãy chạy với cổng khác, ví dụ trên Windows:  set PORT=3003 && npm start\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log(`\nModule chấm điểm website đang chạy tại: http://localhost:${PORT}`);
  console.log('Nhấn Ctrl + C để dừng.\n');
});
