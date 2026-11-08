// Giao diện: gọi API, hiển thị điểm, phần "Cách tính điểm" và chi tiết từng hạng mục kèm bằng chứng.
// Mọi nội dung lấy từ website được kiểm tra đều chèn bằng textContent để tránh chạy mã lạ.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  const STATUS = {
    pass: { icon: '✓', label: 'Đạt' },
    partial: { icon: '!', label: 'Đạt một phần' },
    fail: { icon: '✕', label: 'Chưa đạt' },
  };
  const tone = (ratio) => (ratio >= 0.8 ? 'tone-good' : ratio >= 0.6 ? 'tone-ok' : ratio >= 0.4 ? 'tone-mid' : 'tone-bad');
  const gradeTone = (s) => (s >= 90 ? 'tone-good' : s >= 70 ? 'tone-ok' : s >= 50 ? 'tone-mid' : 'tone-bad');
  const TONE_COLOR = { 'tone-good': '#1d7a46', 'tone-ok': '#1f5fa8', 'tone-mid': '#a35f00', 'tone-bad': '#b42318' };

  let META = null;
  let RESULT = null;
  let FILTER = 'all';

  // ---------- Cách tính điểm ----------
  function renderGuide() {
    const body = $('guide-body');
    body.textContent = '';
    const { groups, criteria } = META;

    const a = el('section');
    a.append(el('h3', null, 'Cách tính chung'),
      el('p', null, `Website được kiểm tra theo ${criteria.length} tiêu chí, chia thành ${groups.length} nhóm. Mỗi tiêu chí có điểm tối đa 1, 2 hoặc 3 tùy mức độ quan trọng. Điểm tổng là tổng điểm của ${criteria.length} tiêu chí, tối đa 100. Kết quả được chấm tự động bằng quy tắc cố định: cùng một trang luôn cho cùng một điểm, không dùng AI để chấm.`));

    const b = el('section');
    b.append(el('h3', null, 'Bảng điểm 7 nhóm'));
    const t = el('table', 'tbl stack');
    const thead = el('thead');
    const hr = el('tr');
    ['Nhóm', 'Câu hỏi nhóm trả lời', 'Số tiêu chí', 'Điểm tối đa'].forEach((h, i) => hr.append(el('th', i >= 2 ? 'num' : null, h)));
    thead.append(hr);
    const tb = el('tbody');
    let totalN = 0, totalMax = 0;
    for (const g of groups) {
      const items = criteria.filter((c) => c.group === g.key);
      const max = items.reduce((s, c) => s + c.max, 0);
      totalN += items.length; totalMax += max;
      const tr = el('tr');
      [[`${g.key}. ${g.label}`, 'Nhóm'], [g.question, 'Câu hỏi'], [items.length, 'Số tiêu chí'], [max, 'Điểm tối đa']].forEach(([v, lab], i) => {
        const td = el('td', i >= 2 ? 'num' : null, String(v));
        td.dataset.label = lab;
        tr.append(td);
      });
      tb.append(tr);
    }
    const tf = el('tfoot');
    const fr = el('tr');
    [['Tổng', ''], ['', ''], [totalN, 'Số tiêu chí'], [totalMax, 'Điểm tối đa']].forEach(([v, lab], i) => {
      const td = el('td', i >= 2 ? 'num' : null, String(v));
      if (lab) td.dataset.label = lab;
      fr.append(td);
    });
    tf.append(fr);
    t.append(thead, tb, tf);
    b.append(t);

    const c = el('section');
    c.append(el('h3', null, 'Cách chấm từng tiêu chí'), el('p', 'muted', 'Bấm vào từng nhóm để xem các tiêu chí, điểm tối đa và điều kiện Đạt / Đạt một phần / Chưa đạt.'));
    for (const g of groups) {
      const items = criteria.filter((x) => x.group === g.key);
      const d = el('details', 'groupdetail');
      const s = el('summary');
      s.append(el('span', 'badge', g.key), el('span', null, g.label), el('span', 'muted', `${items.length} tiêu chí · ${items.reduce((x, y) => x + y.max, 0)} điểm`));
      const ul = el('ul', 'howlist');
      for (const it of items) {
        const li = el('li');
        const name = el('div', 'hl-name');
        name.append(el('span', null, it.label), el('span', 'muted', `tối đa ${it.max} điểm`));
        li.append(name, el('div', 'hl-how', it.howScored));
        ul.append(li);
      }
      d.append(s, ul);
      c.append(d);
    }

    const d = el('section');
    d.append(el('h3', null, 'Ý nghĩa trạng thái'));
    const ul = el('ul', 'legend');
    const leg = [
      ['pass', 'Đạt: nhận đủ điểm của tiêu chí.'],
      ['partial', 'Đạt một phần: có thực hiện nhưng chưa đúng chuẩn, nhận một nửa số điểm làm tròn xuống (tiêu chí 3 điểm → 1 điểm, 2 điểm → 1 điểm). Tiêu chí 1 điểm không có mức này.'],
      ['fail', 'Chưa đạt: không tìm thấy hoặc sai hoàn toàn, nhận 0 điểm.'],
    ];
    for (const [s, txt] of leg) {
      const li = el('li', 's-' + s);
      li.append(el('span', 'icon', STATUS[s].icon), el('span', null, txt));
      ul.append(li);
    }
    d.append(ul);

    const e = el('section');
    e.append(el('h3', null, 'Cách đọc số liệu'));
    const ul2 = el('ul', 'legend');
    [
      '"18/22": nhóm đạt 18 điểm trên tối đa 22 điểm. Thanh màu thể hiện tỷ lệ đạt của nhóm: xanh lá từ 80%, xanh dương 60–79%, vàng 40–59%, đỏ dưới 40%.',
      '"📍 Chân trang · dòng 245": bằng chứng nằm ở chân trang, dòng 245 trong mã nguồn của trang. Khung xám bên dưới là đoạn mã được trích nguyên văn.',
      'Xếp loại điểm tổng: 90–100 Xuất sắc · 70–89 Khá · 50–69 Trung bình · dưới 50 Cần cải thiện gấp.',
    ].forEach((tx) => ul2.append(el('li', null, '• ' + tx)));
    e.append(ul2);

    const f = el('section');
    f.append(el('h3', null, 'Giới hạn và cách tự kiểm tra'),
      el('p', null, 'Công cụ đọc mã HTML ban đầu của trang. Với website dựng hoàn toàn bằng JavaScript, một số thông tin có thể không được nhận diện và kết quả có thể thấp hơn thực tế. Các tiêu chí về sản phẩm/dịch vụ và dấu hiệu niềm tin chỉ nhận diện dấu hiệu bên ngoài, không đánh giá chất lượng nội dung. Để tự kiểm tra: mở website, nhấn Ctrl+U để xem mã nguồn, rồi nhấn Ctrl+F tìm đoạn mã hoặc cuộn tới số dòng ghi trong bằng chứng.'));

    body.append(a, b, c, d, e, f);
  }

  // ---------- Tổng quan ----------
  function fmtTime(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
  }
  function renderSummary(r) {
    $('score').textContent = r.score;
    const gt = gradeTone(r.score);
    const grade = $('grade');
    grade.className = 'grade ' + gt;
    grade.textContent = r.grade;
    const circ = 2 * Math.PI * 52;
    const fg = $('ring-fg');
    fg.style.stroke = TONE_COLOR[gt];
    fg.style.strokeDasharray = String(circ);
    fg.style.strokeDashoffset = String(circ);
    requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = String(circ * (1 - r.score / 100)); }));
    $('final-url').textContent = r.finalUrl;
    $('checked-at').textContent = fmtTime(r.checkedAt);
    const n = (s) => r.checks.filter((c) => c.status === s).length;
    $('counts').textContent = `${n('pass')} đạt · ${n('partial')} một phần · ${n('fail')} chưa đạt`;

    const bars = $('bars');
    bars.textContent = '';
    for (const g of r.groups) {
      const li = el('li', 'bar-row ' + tone(g.points / g.max));
      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = Math.round((g.points / g.max) * 100) + '%';
      track.append(fill);
      li.append(el('span', 'bar-label', g.label), el('span', 'bar-num', `${g.points}/${g.max}`), track);
      bars.append(li);
    }
    $('summary').hidden = false;
  }

  // ---------- Chi tiết ----------
  function renderFilters(r) {
    const box = $('filters');
    box.textContent = '';
    const n = (s) => r.checks.filter((c) => s === 'all' || c.status === s).length;
    [['all', 'Tất cả'], ['fail', 'Chưa đạt'], ['partial', 'Đạt một phần'], ['pass', 'Đạt']].forEach(([k, label]) => {
      const b = el('button', 'chip', `${label} (${n(k)})`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(FILTER === k));
      b.addEventListener('click', () => { FILTER = k; renderFilters(r); applyFilter(); });
      box.append(b);
    });
  }
  function applyFilter() {
    document.querySelectorAll('#checklist .item').forEach((it) => { it.hidden = FILTER !== 'all' && it.dataset.status !== FILTER; });
    document.querySelectorAll('#checklist .group').forEach((g) => {
      const any = g.querySelector('.item:not([hidden])');
      g.hidden = !any;
    });
    const empty = $('checklist').querySelector('.empty');
    const anyVisible = $('checklist').querySelector('.group:not([hidden])');
    if (!anyVisible && !empty) $('checklist').append(el('p', 'empty', 'Không có hạng mục nào ở trạng thái này.'));
    if (anyVisible && empty) empty.remove();
  }

  function renderItem(c) {
    const it = el('article', 'item s-' + c.status);
    it.dataset.status = c.status;
    const icon = el('span', 'icon', STATUS[c.status].icon);
    icon.title = STATUS[c.status].label;
    icon.setAttribute('aria-label', STATUS[c.status].label);
    const head = el('div');
    head.append(el('div', 'item-name', c.label), el('div', 'item-desc', c.description));
    const pts = el('div', 'item-pts', `${c.points}/${c.max}`);

    const body = el('div', 'item-body');
    const how = el('p', 'how');
    how.append(el('b', null, 'Cách chấm: '), document.createTextNode(c.howScored));

    const res = el('div', 'result');
    res.append(el('div', 'result-label', 'Kết quả · ' + STATUS[c.status].label), el('p', 'detail', c.detail));
    const evs = el('div', 'evs');
    for (const e of c.evidence || []) {
      const box = el('div');
      box.append(el('div', 'ev-loc', '📍 ' + e.location + (e.line ? ' · dòng ' + e.line : '')));
      if (e.snippet) box.append(el('pre', 'ev-code', e.snippet));
      if (e.value) box.append(el('div', 'ev-val', 'Giá trị: ' + e.value));
      evs.append(box);
    }
    const show = c.status !== 'pass';
    evs.hidden = !show;
    const tog = el('button', 'ev-toggle', show ? 'Ẩn bằng chứng' : 'Hiện bằng chứng');
    tog.type = 'button';
    tog.setAttribute('aria-expanded', String(show));
    tog.addEventListener('click', () => {
      evs.hidden = !evs.hidden;
      tog.textContent = evs.hidden ? 'Hiện bằng chứng' : 'Ẩn bằng chứng';
      tog.setAttribute('aria-expanded', String(!evs.hidden));
    });
    res.append(tog, evs);
    body.append(how, res);
    if (c.fix) {
      const fx = el('p', 'fix');
      fx.append(el('b', null, 'Cách khắc phục: '), document.createTextNode(c.fix));
      body.append(fx);
    }
    it.append(icon, head, pts, body);
    return it;
  }

  function renderChecklist(r) {
    const box = $('checklist');
    box.textContent = '';
    for (const g of r.groups) {
      const sec = el('section', 'group');
      const head = el('div', 'group-head ' + tone(g.points / g.max));
      const titles = el('div');
      titles.append(el('h3', null, g.label), el('p', 'q', g.question));
      head.append(el('span', 'badge', g.key), titles, el('span', 'gpts', `${g.points}/${g.max}`));
      sec.append(head);
      for (const c of r.checks.filter((x) => x.group === g.key)) sec.append(renderItem(c));
      box.append(sec);
    }
    FILTER = 'all';
    renderFilters(r);
    applyFilter();
    $('details').hidden = false;
  }

  // ---------- Gửi kiểm tra ----------
  async function check(url) {
    const btn = $('submit');
    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra…';
    $('error').hidden = true;
    $('loading').hidden = false;
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({ error: 'Máy chủ trả về dữ liệu không đọc được.' }));
      if (!res.ok) throw new Error(data.error || 'Không kiểm tra được website.');
      RESULT = data;
      renderSummary(data);
      renderChecklist(data);
      $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      const msg = e instanceof TypeError ? 'Không kết nối được máy chủ của công cụ. Hãy kiểm tra cửa sổ dòng lệnh còn đang chạy.' : e.message;
      $('error').textContent = msg;
      $('error').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Kiểm tra';
      $('loading').hidden = true;
    }
  }

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('url').value.trim();
    if (v) check(v);
  });

  fetch('/api/criteria').then((r) => r.json()).then((m) => { META = m; renderGuide(); })
    .catch(() => { $('guide-body').textContent = 'Không tải được nội dung cách tính điểm.'; });

  // để kiểm thử: ?demo=1 sẽ không tự chạy gì; RESULT có thể xem trong console
  window.__auditResult = () => RESULT;
})();
