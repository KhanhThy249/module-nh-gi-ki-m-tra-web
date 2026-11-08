# Module chấm điểm website chuẩn marketing (60 tiêu chí)

Nhập địa chỉ website → nhận **điểm /100**, điểm **7 nhóm**, phần **Cách tính điểm** và **Chi tiết đánh giá**
cho đủ 60 hạng mục. Mỗi hạng mục có: giải thích ngắn, cách chấm, kết quả, **bằng chứng** (vị trí, số dòng,
đoạn mã trích nguyên văn) và cách khắc phục nếu chưa đạt.

Module **không cần cài thư viện** (không cần `npm install`), chỉ cần Node.js 20 trở lên.

## Cách chạy (Windows)

1. Mở Command Prompt **trong thư mục này** (bấm vào thanh địa chỉ của File Explorer, gõ `cmd`, Enter).
2. Gõ: `npm start`
3. Mở trình duyệt: **http://localhost:3002**
4. Dừng: nhấn **Ctrl + C** trong cửa sổ Command Prompt.

Nếu báo cổng 3002 đang bận: `set PORT=3003 && npm start`, rồi mở http://localhost:3003

## Chạy kiểm thử

`npm test` — 37 bài kiểm tra (60 tiêu chí, trang đạt hết = 100 điểm, trang trượt hết = 0 điểm,
từng trường hợp đặc biệt, chặn địa chỉ nội bộ, chuyển hướng, giới hạn 2 MB, quá 10 giây).

## Cấu trúc

| Tệp | Vai trò |
|---|---|
| `server.mjs` | Máy chủ: phục vụ giao diện, API `POST /api/analyze` và `GET /api/criteria` |
| `lib/fetchPage.mjs` | Tải trang: chuyển hướng (tối đa 5), chặn địa chỉ nội bộ, 10 giây, 2 MB, robots.txt, sitemap, favicon |
| `lib/htmlParser.mjs` | Đọc HTML thành cây phần tử, nhớ số dòng của từng thẻ |
| `lib/dom.mjs` | Hàm tìm phần tử và trích bằng chứng (vị trí, dòng, đoạn mã ≤ 160 ký tự) |
| `lib/criteria.mjs` | 60 tiêu chí: tên, điểm tối đa, giải thích, cách chấm, cách khắc phục |
| `lib/rules.mjs` | Logic chấm từng tiêu chí (quy tắc cố định, không dùng AI) |
| `lib/score.mjs` | Tính điểm tiêu chí, nhóm, tổng và xếp loại |
| `public/` | Giao diện (HTML, CSS, JavaScript) |
| `tests/` | Kiểm thử và trang HTML mẫu |

## Quy tắc tính điểm

- Đạt = đủ điểm · Đạt một phần = nửa điểm làm tròn xuống · Chưa đạt = 0. Tiêu chí 1 điểm chỉ có Đạt/Chưa đạt.
- 7 nhóm: SEO & hiển thị 22 · Chuẩn kỹ thuật 19 · Di động & hình ảnh 12 · Tốc độ tải 8 ·
  Marketing & chuyển đổi 17 · Tin cậy & minh bạch 7 · Trải nghiệm & truy cập 15 = 100.
- Xếp loại: 90–100 Xuất sắc · 70–89 Khá · 50–69 Trung bình · dưới 50 Cần cải thiện gấp.

## API (để nối với module khác)

```
POST /api/analyze   body: { "url": "tenmien.vn" }
→ 200 { url, finalUrl, checkedAt, score, grade, groups[7], checks[60] }
→ 400 { error: "thông báo tiếng Việt" }
```

Mỗi phần tử `checks`: `{ key, group, label, description, howScored, status, points, max, detail, evidence[], fix? }`,
với `evidence`: `{ location, line?, snippet?, value? }`.

## Giới hạn

Công cụ đọc mã HTML ban đầu của trang. Website dựng hoàn toàn bằng JavaScript có thể bị chấm thấp hơn thực tế.
Tiêu chí sản phẩm/dịch vụ và dấu hiệu niềm tin chỉ nhận diện dấu hiệu, không đánh giá chất lượng nội dung.
