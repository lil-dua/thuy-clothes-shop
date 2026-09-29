# Lumi Shop

## Tổng quan
Website bán quần áo nữ & trẻ em (storefront + trang quản trị), chạy trên Cloudflare Workers. Khách mua hàng không cần tài khoản; chỉ chủ shop/nhân viên đăng nhập để quản trị.

## Stack & cấu trúc
- Ngôn ngữ/framework: React Router v7 (framework mode, SSR) + React 19 + TypeScript, chạy trên **Cloudflare Workers**. Tailwind v4 cho style.
- Dữ liệu: **Cloudflare D1** (binding `DB`, tên `lumi-shop-db`, migrations ở `db/migrations/`). Ảnh: **R2** (binding `IMAGES`, bucket `lumi-shop-images`), phục vụ qua route `/anh/*`.
- Thư mục chính:
  - `app/routes/shop/*` — storefront (khách hàng).
  - `app/routes/admin/*` — trang quản trị (yêu cầu đăng nhập qua `requireAdmin`).
  - `app/lib/*.server.ts` — logic chỉ chạy server (DB, auth, cookie, tích hợp ngoài). `*.ts` không hậu tố `.server` là code dùng chung client/server, tuyệt đối không import module `*.server.ts`.
  - `app/routes.ts` — khai báo route tập trung.
  - `workers/app.ts` — entry worker (bọc security headers, Origin check, cron `scheduled` mỗi 15 phút).
  - `db/migrations/` — migration D1; `scripts/` — seed, backup, tạo admin.
  - `docs/PLAN.md` — nơi trao đổi giữa các agent khi làm việc theo quy trình đội (xem bên dưới).
- Truy cập DB luôn qua `db.prepare().bind()` (D1 prepared statements) — không nội suy input thô vào SQL.
- Tích hợp ngoài: Typefully (đăng Threads), Resend (email), Telegram (thông báo đơn hàng). Secret đọc qua `getSecret()` trong `app/lib/settings.server.ts` — ưu tiên env var (`context.cloudflare.env`, đặt bằng `wrangler secret put` ở production, `.dev.vars` ở local), fallback bảng `settings` trong D1.

## Lệnh thường dùng
- Cài đặt: `npm install`
- Chạy dev: `npm run dev`
- Kiểm tra nhanh (typegen + tsc + build + wrangler dry-run): `npm run check`
- Chỉ typecheck: `npm run typecheck`
- Build: `npm run build`
- Deploy: `npm run deploy`
- Migrate D1 local: `npm run db:migrate` (remote: `npm run db:migrate:remote`)
- Seed dữ liệu mẫu: `npm run db:seed`, `npm run db:seed-orders`, `npm run db:seed-categories`
- Reset D1 local: `npm run db:reset`
- Query D1 local nhanh: `npm run db:studio "SELECT ..."`
- Backup D1 ra file .sql: `npm run db:backup`
- Tạo tài khoản admin: `ADMIN_PASSWORD='...' npm run admin:create -- <username> "<Tên hiển thị>"`
- **Chưa có test runner tự động** — kiểm chứng bằng `curl`, `npm run db:studio`, và `npm run check`.
- Không chạy lệnh có `--remote` (D1/R2 thật) trừ khi người dùng yêu cầu rõ ràng.

## Quy ước code
- Logic server nằm trong `app/lib/*.server.ts`; route dùng `loader`/`action` của React Router.
- Mọi loader/action trong `app/routes/admin/**` phải tự gọi `await requireAdmin(db, request)` ở đầu — layout cha KHÔNG bảo vệ được `action` (React Router không chạy loader của layout cha khi xử lý action).
- Comment tiếng Việt, chỉ giải thích "vì sao" khi không hiển nhiên (constraint ẩn, workaround) — không comment mô tả code làm gì.
- Validate input ở server là chốt chặn thật (giá/tổng tiền luôn tính lại từ D1, không nhận từ form); validate client chỉ hỗ trợ UX.
- Không trả dữ liệu nội bộ (giá vốn `cost_price`/`unit_cost`, `admin_note`, secret) ra loader data của route storefront (khách) — chỉ admin (đã qua `requireAdmin`) mới được thấy.
- Bảo mật: cookie nhạy cảm phải ký (`secrets` của `createCookie`), fail-closed khi thiếu secret; rate limit các endpoint công khai dễ bị dò/brute-force (đăng nhập, tra cứu đơn, checkout) bằng bảng D1 `rate_limits` (`app/lib/rate-limit.server.ts`).

## Quy trình đội agent
Tính năng hoặc bug không nhỏ đi theo thứ tự: **planner → dev → tester → reviewer**.
Việc nhỏ (sửa 1-2 dòng, đổi text) làm thẳng, bỏ qua quy trình.

- Các subagent KHÔNG thấy lịch sử chat. Thông tin cần chia sẻ phải nằm trong file này, `docs/PLAN.md`, hoặc prompt giao việc.
- `docs/PLAN.md` là nơi trao đổi chung: planner viết kế hoạch, dev đánh dấu task và điền Dev notes, tester điền Test report.
- Phiên chính đóng vai điều phối: giao việc cho từng agent, chuyển kết quả sang agent kế tiếp, không tự viết code thay dev.
- Vòng sửa: tester báo FAIL hoặc reviewer báo CHANGES REQUESTED thì chuyển phản hồi cho dev, sau đó tester chạy lại và reviewer duyệt lại. Tối đa 2 vòng, sau đó dừng và hỏi người dùng.
- Kết thúc: tóm tắt cho người dùng gồm đã làm gì, kết quả test, verdict của reviewer, việc còn lại. Không commit hay push nếu người dùng chưa yêu cầu.

## Ngôn ngữ
Trả lời bằng tiếng Việt. Giữ nguyên thuật ngữ kỹ thuật, tên biến, lệnh bằng tiếng Anh.
