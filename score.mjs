// Ghép 60 tiêu chí, tính điểm từng nhóm và điểm tổng.
import { loadDoc } from './dom.mjs';
import { CRITERIA, GROUPS } from './criteria.mjs';
import * as RULES from './rules.mjs';
import { fetchPage } from './fetchPage.mjs';

export function pointsFor(status, max) {
  if (status === 'pass') return max;
  if (status === 'partial') return Math.floor(max / 2);
  return 0;
}

export function gradeOf(score) {
  if (score >= 90) return 'Xuất sắc';
  if (score >= 70) return 'Khá';
  if (score >= 50) return 'Trung bình';
  return 'Cần cải thiện gấp';
}

/** Chấm điểm từ mã HTML và dữ liệu đã tải (không gọi mạng). */
export function scoreHtml(html, ctx) {
  const doc = loadDoc(html);
  const checks = CRITERIA.map((c) => {
    const fn = RULES[c.key];
    let res;
    try {
      res = fn(doc, ctx);
    } catch (e) {
      res = { status: 'fail', detail: 'Không kiểm tra được tiêu chí này do lỗi khi đọc trang.', evidence: [{ location: 'Không xác định', value: String(e && e.message || e) }] };
    }
    let status = res.status;
    if (c.max === 1 && status === 'partial') status = 'fail'; // tiêu chí 1 điểm chỉ có Đạt / Chưa đạt
    const out = {
      key: c.key, group: c.group, label: c.label, description: c.description, howScored: c.howScored,
      status, points: pointsFor(status, c.max), max: c.max,
      detail: res.detail, evidence: (res.evidence || []).slice(0, 3),
    };
    if (status !== 'pass') out.fix = c.fix;
    return out;
  });
  const groups = GROUPS.map((g) => {
    const items = checks.filter((x) => x.group === g.key);
    return {
      key: g.key, label: g.label, question: g.question,
      points: items.reduce((s, x) => s + x.points, 0), max: items.reduce((s, x) => s + x.max, 0),
      count: items.length,
    };
  });
  const score = groups.reduce((s, g) => s + g.points, 0);
  return { score, grade: gradeOf(score), groups, checks };
}

function vietnamTime(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '+07:00');
}

export async function analyzeUrl(url, opts = {}) {
  const ctx = await fetchPage(url, opts);
  const result = scoreHtml(ctx.html, ctx);
  return {
    url: ctx.inputUrl, finalUrl: ctx.finalUrl, checkedAt: vietnamTime(Date.now()),
    responseTimeMs: ctx.responseTimeMs, sizeBytes: ctx.sizeBytes,
    ...result,
  };
}
