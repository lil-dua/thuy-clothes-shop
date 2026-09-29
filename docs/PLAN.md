# Kế hoạch: Kiểm tra bảo mật toàn site (audit + fix)

## Mục tiêu
Rà soát bảo mật toàn bộ website Lumi (storefront + admin) và sửa ngay các lỗ hổng tìm thấy.
Mỗi task = kiểm tra 1 nhóm rủi ro cụ thể **và** sửa trong cùng task, với thay đổi tối thiểu,
không làm hỏng luồng mua hàng không cần đăng nhập.

## Ngữ cảnh kỹ thuật (đã khảo sát)
- Stack: React Router v7 (framework mode, SSR) chạy trên **Cloudflare Workers**.
  Entry worker: `workers/app.ts` (có cả `scheduled` cron mỗi 15 phút). Cấu hình: `wrangler.json`.
- Dữ liệu: **Cloudflare D1** (binding `DB`, tên `lumi-shop-db`, migrations ở `db/migrations/`).
  Ảnh: **R2** (binding `IMAGES`, bucket `lumi-shop-images`), phục vụ qua route `/anh/*`.
- Khai báo route tập trung ở `app/routes.ts`. Truy cập DB qua `db.prepare().bind()` (D1 prepared statements).
- Auth admin: `app/lib/auth.server.ts` — PBKDF2-SHA256 (100k vòng) + session token 32 byte
  lưu bảng `admin_sessions`, cookie `lumi_admin_session` (httpOnly, sameSite=lax, secure ở PROD).
- Khách mua **không có tài khoản**: giỏ hàng + mã đơn vừa đặt lưu trong cookie
  (`app/lib/cart.server.ts`, `app/lib/recent-orders.server.ts`).
- Secrets tích hợp ngoài (Typefully/Resend/Telegram) đọc qua `getSecret()` — ưu tiên env var,
  fallback bảng `settings` trong D1 (`app/lib/settings.server.ts`).
- Lệnh: dev `npm run dev`; kiểm tra build/type `npm run check`; migrate local `npm run db:migrate`;
  seed `npm run db:seed`. **Chưa có test runner** — tester dùng `curl` + `npm run check`.

## Phạm vi
**Làm**
- Audit + fix: authz admin, session/cookie, IDOR đơn hàng, upload/serve ảnh, export CSV,
  input validation/injection, XSS, CSRF, security headers, rate limiting, rò rỉ secret/PII,
  bảo vệ file backup D1, cấu hình wrangler, dependency.
- Mỗi task có bước "cách kiểm chứng" để dev tự xác nhận trước khi chuyển tester.

**Không làm**
- Không thêm đăng nhập cho khách mua hàng, không đổi kiến trúc, không đổi UI/UX.
- Không thêm dependency mới nếu Workers runtime/D1 đã đủ (ưu tiên WebCrypto, D1, cookie có sẵn).
- Không đổi schema D1 trừ khi task ghi rõ (T3 có thể cần 1 migration cho rate limit).
- Không chạy quét tự động vào môi trường production, không `--remote` trên D1 thật.

---

## Các task

### Nhóm A — Đã phát hiện vấn đề rõ ràng khi đọc code (ƯU TIÊN CAO, làm trước)

- [x] **T1 (CRITICAL): Mọi loader/action trong `/admin` phải tự gọi `requireAdmin`**
  Hiện chỉ có `routes/admin/layout.tsx`, `routes/admin/settings.tsx`, `routes/admin/orders-csv.ts`
  gọi `requireAdmin`. React Router **không chạy loader của layout cha khi xử lý `action`**, nên POST
  vô danh tới các route dưới đây thực thi được thao tác ghi mà không cần đăng nhập:
  - `app/routes/admin/products.tsx` — `action` đổi sản phẩm sang `discontinued`.
  - `app/routes/admin/product-new.tsx` — `action` tạo sản phẩm, còn **đăng bài Threads bằng API key của shop**.
  - `app/routes/admin/product-edit.tsx` — `action` sửa sản phẩm/ảnh, `post-threads`, `cancel-threads`.
  - `app/routes/admin/order-detail.tsx` — `action` đổi trạng thái đơn, `mark-paid`, ghi `admin_note`.
  - `app/routes/admin/discounts.tsx` — `action` tạo/sửa/xoá mã giảm giá.
  - `app/routes/admin/reviews.tsx` — `action` ẩn/hiện đánh giá.
  Đồng thời các `loader` sau **không nhận `request`** nên không kiểm tra được phiên, chỉ dựa vào layout:
  `admin/order-detail.tsx`, `admin/order-slip.tsx`, `admin/discounts.tsx`, `admin/product-new.tsx`.
  Việc cần làm: thêm `await requireAdmin(db, request)` vào **đầu mọi `loader` và `action`** trong
  `app/routes/admin/**` (trừ `login.tsx`; `logout.ts` giữ nguyên hành vi), đổi signature loader để nhận `request`.
  Kiểm chứng thêm: React Router single fetch cho phép lọc loader bằng query `?_routes=...` trên URL `.data`
  — xác nhận `/admin/don-hang/1.data?_routes=routes/admin/order-detail` (và tương tự) không còn trả dữ liệu
  khi chưa đăng nhập.
  (file dự kiến: toàn bộ `app/routes/admin/*.tsx|ts`, có thể thêm helper trong `app/lib/auth.server.ts`)

- [x] **T2 (HIGH): Cookie `lumi_orders` không được ký → xem được đơn của người khác (IDOR + rò rỉ PII)**
  `app/lib/recent-orders.server.ts` dùng `createCookie("lumi_orders", {...})` **không truyền `secrets`**,
  nên giá trị chỉ là base64 JSON do client tự đặt được (httpOnly chỉ chặn JS, không chặn `curl -H "Cookie: ..."`).
  `canViewOrder()` vì thế bị vượt qua dễ dàng: mã đơn dạng `LUMI` + 5 chữ số (xem `generateOrderCode`
  trong `app/lib/order.server.ts`) hoàn toàn dò được → lộ tên, số điện thoại, địa chỉ, và gửi được đánh giá hộ.
  Việc cần làm: ký cookie bằng `secrets` lấy từ env (ví dụ `COOKIE_SECRET`, đọc từ `context.cloudflare.env`),
  hoặc thay bằng token ngẫu nhiên lưu DB. Rà cả `lumi_cart` và `lumi_discount` (`app/lib/cart.server.ts`) —
  giỏ hàng chỉ giữ id/số lượng nên rủi ro thấp hơn, nhưng cần kết luận rõ ràng.
  Ghi vào Dev notes cách nạp secret ở dev (`.dev.vars`) và ở production (`wrangler secret put`), kèm
  hành vi khi thiếu secret (fail-closed, không âm thầm bỏ ký).
  (file dự kiến: `app/lib/recent-orders.server.ts`, `app/lib/cart.server.ts`, các route đọc cookie,
  `wrangler.json`, `.dev.vars.example`)

- [x] **T3 (HIGH): Rate limiting / chống dò**
  Không có giới hạn tần suất ở bất kỳ đâu. Điểm cần bảo vệ:
  - `app/routes/admin/login.tsx` — brute force mật khẩu admin (PBKDF2 100k vòng còn là vector tốn CPU).
  - `app/routes/shop/order-lookup.tsx` — dò cặp (mã đơn, số điện thoại).
  - `app/routes/shop/checkout.tsx` — spam đơn, kéo theo spam email Resend / tin Telegram.
  - `app/routes/api.cart.ts` — spam ghi cookie (ưu tiên thấp).
  Việc cần làm: chọn cơ chế đơn giản, không thêm dependency — đếm theo IP (`CF-Connecting-IP`) + theo
  khoá (username / mã đơn) trong một bảng D1 nhỏ, hoặc Cloudflare Rate Limiting rules ghi rõ trong Dev notes.
  Nếu thêm bảng thì tạo migration mới `db/migrations/0007_*.sql` và dọn bản ghi cũ.
  Phải thất bại "mềm": chặn thì trả 429 + thông báo tiếng Việt, không làm hỏng luồng mua hàng thật.
  (file dự kiến: `app/lib/rate-limit.server.ts` (mới), `db/migrations/0007_rate_limit.sql`,
  `app/routes/admin/login.tsx`, `app/routes/shop/order-lookup.tsx`, `app/routes/shop/checkout.tsx`)

### Nhóm B — Audit từng nhóm rủi ro (kiểm tra + sửa nếu có lỗi)

- [x] **T4: Security headers & bảo vệ response**
  Kiểm tra `app/entry.server.tsx` (hiện chỉ set `Content-Type`) và `workers/app.ts`: thiếu
  `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `X-Frame-Options`/`frame-ancestors`, `Strict-Transport-Security`, `Permissions-Policy`.
  Thêm ở một chỗ duy nhất (bọc handler trong `workers/app.ts` hoặc `entry.server.tsx`).
  CSP phải không phá hydration của React Router (chú ý inline script/style của Tailwind v4 và
  `<script>` hydrate) — nếu chưa làm được CSP chặt thì làm `Report-Only` và ghi lý do vào Dev notes.
  Kiểm tra thêm `app/routes/anh.ts`: response ảnh cần `nosniff` và `Content-Type` an toàn.
  (file dự kiến: `workers/app.ts`, `app/entry.server.tsx`, `app/routes/anh.ts`)

- [x] **T5: Secrets, env var và client bundle**
  - Grep toàn repo tìm khoá/mật khẩu hardcode: `sk_`, `re_`, `bot[0-9]`, `Bearer `, `api_key`,
    `password`, `token` (bỏ qua `node_modules/`, `build/`).
  - Xác nhận không có secret nào lọt vào bundle gửi xuống browser: chạy `npm run build` rồi grep trong
    `build/client/**` các giá trị bí mật và tên `typefully_api_key`, `resend_api_key`, `telegram_bot_token`.
    Quy ước hiện tại: chỉ file `*.server.ts` được đọc secret; `app/lib/threads.ts` và `app/lib/images.ts`
    là code dùng chung client/server — kiểm tra hai file này không kéo theo module server.
  - Xác nhận `SECRET_KEYS` trong `app/lib/settings.server.ts` không bao giờ lọt vào loader data
    (`hasSecret` chỉ trả boolean — kiểm tra lại mọi nơi gọi `getSecret` đều ở server và không return ra client).
  - Kiểm tra `wrangler.json`: `vars` chỉ chứa dữ liệu công khai (hiện đúng), `upload_source_maps: true`
    và `observability.enabled: true` — đánh giá xem log Workers có ghi PII khách hàng không
    (`console.log`/`console.error` trong `app/lib/notify.server.ts`, `email.server.ts`, `telegram.server.ts`,
    `threads.server.ts`, `workers/app.ts`); nếu có thì lược bỏ số điện thoại/địa chỉ khỏi log.
  - Kiểm tra `.gitignore` đã loại `.env*`, `.dev.vars*`, `/backups/` (hiện có) và `git ls-files` không
    lỡ track file nào trong số đó.
  (file dự kiến: `app/lib/settings.server.ts`, `wrangler.json`, `.gitignore`, các file `*.server.ts` có log)

- [x] **T6: Upload file & phục vụ ảnh (R2)**
  - `app/lib/images.server.ts`: hiện chỉ tin `file.type` do client gửi và giới hạn 5MB/ảnh.
    Bổ sung kiểm tra magic bytes (JPEG/PNG/WebP/AVIF), chuẩn hoá `Content-Type` lưu vào R2 theo kết quả
    sniff thay vì theo client, và giới hạn **số lượng ảnh mỗi lần submit** (`app/lib/product-form.server.ts`
    hiện lặp không giới hạn qua `form.getAll("images")`).
  - `app/routes/anh.ts`: hiện `IMAGES.get(params["*"])` cho phép đọc **bất kỳ key nào** trong bucket.
    Giới hạn prefix hợp lệ (`products/`, `settings/`) và từ chối key có `..`, ký tự điều khiển, hoặc quá dài.
    Thêm `X-Content-Type-Options: nosniff`; nếu `Content-Type` không thuộc danh sách ảnh cho phép thì
    trả về kèm `Content-Disposition: attachment` hoặc 404.
  - Kiểm tra `app/routes/anh-mac-dinh.ts` (SVG placeholder sinh động): `params.kind` phải nằm trong allowlist,
    không nội suy input người dùng vào SVG.
  - Kiểm tra đường xoá ảnh trong `product-form.server.ts` vẫn scope theo `product_id` (hiện đúng — giữ nguyên).
  (file dự kiến: `app/lib/images.server.ts`, `app/lib/product-form.server.ts`, `app/routes/anh.ts`,
  `app/routes/anh-mac-dinh.ts`)

- [x] **T7: Injection & validation input**
  - SQL: rà toàn bộ `app/lib/db.server.ts`, `order.server.ts`, `reviews.server.ts`, `threads.server.ts`,
    `settings.server.ts` — mọi giá trị phải qua `.bind()`. Chú ý các đoạn nội suy chuỗi vào SQL:
    `ORDER BY ${orderBy}` (`listProducts`, `listAdminProducts`), `${where}`, `${holes}`, `${groupClause}`,
    `${statusClause}`, `${activeClause}`, `${keepClause}`. Xác nhận tất cả đều lấy từ allowlist/sinh nội bộ
    (hiện `SORT_SQL` được allowlist ở `app/routes/shop/products.tsx`) và không route nào truyền `sort` thô.
  - Số lượng placeholder: `sizes`/`colors` từ `searchParams.getAll(...)` không giới hạn độ dài
    (`app/routes/shop/products.tsx`) → có thể vượt giới hạn biến của D1 và gây lỗi 500. Giới hạn số phần tử.
    Tương tự `orders-csv.ts` dựng `IN (...)` với tới 5000 id — kiểm tra có chia lô hay không.
  - Validation: kiểm tra `app/routes/shop/checkout.tsx` (độ dài tối đa tên/địa chỉ/ghi chú/email — hiện
    chỉ có độ dài tối thiểu), `app/lib/reviews.server.ts` (`rating` 1..5, độ dài `content`, `authorName`),
    `app/routes/admin/discounts.tsx` (giá trị giảm, ngày hiệu lực), `app/lib/format.ts`
    (`normalizePhone`, `isValidPhone`, `parseVnd`, `slugify`).
  - Giá tiền: xác nhận giá/phí ship/giảm giá luôn tính lại ở server (hiện đúng ở `createOrder`/`loadCartDetails`) —
    không chỗ nào nhận `price`/`total` từ form.
  (file dự kiến: `app/lib/db.server.ts`, `app/lib/order.server.ts`, `app/lib/reviews.server.ts`,
  `app/lib/format.ts`, `app/routes/shop/checkout.tsx`, `app/routes/shop/products.tsx`,
  `app/routes/admin/discounts.tsx`, `app/routes/admin/orders-csv.ts`)

- [x] **T8: XSS & injection ở đầu ra ngoài React**
  React tự escape (đã xác nhận **không** có `dangerouslySetInnerHTML` trong `app/`), nên tập trung vào
  các đầu ra dựng chuỗi thủ công:
  - `app/lib/email.server.ts`: HTML email nội suy nhiều biến. Xác nhận **mọi** giá trị từ khách/đơn hàng
    đều qua `escapeHtml` (kiểm tra kỹ các chỗ nội suy `title`, `inner`, `footer`, `label`, `value`, `qr`
    — một số chỗ hiện nội suy trực tiếp, cần xác định nguồn dữ liệu là nội bộ hay do người dùng nhập).
  - `app/lib/telegram.server.ts`: gửi `parse_mode=HTML` — kiểm tra mọi biến đều qua `escapeHtml`
    (hiện phần lớn có) và `shopUrl` không bị chèn.
  - `app/lib/threads.server.ts`: caption dựng từ template + dữ liệu sản phẩm → kiểm tra không chèn được
    ký tự phá payload JSON / không lộ dữ liệu ngoài sản phẩm.
  - `app/routes/sitemap.ts`: XML nội suy slug/URL → cần escape XML.
  - **CSV formula injection** ở `app/routes/admin/orders-csv.ts`: `escapeCell` chỉ escape dấu `"`;
    ô bắt đầu bằng `=`, `+`, `-`, `@`, tab, CR (ví dụ tên hoặc ghi chú do khách nhập) sẽ thành công thức
    khi mở bằng Excel/Sheets. Thêm tiền tố vô hiệu hoá công thức.
  (file dự kiến: `app/lib/email.server.ts`, `app/lib/telegram.server.ts`, `app/lib/threads.server.ts`,
  `app/routes/sitemap.ts`, `app/routes/admin/orders-csv.ts`)

- [x] **T9: CSRF, cookie & session**
  - Tất cả cookie hiện là `sameSite: "lax"` — chặn được POST cross-site cơ bản, nhưng cần xác nhận:
    (a) không có route nào đổi trạng thái bằng **GET** (kiểm tra `app/routes/admin/logout.ts`,
    `app/routes/api.cart.ts` loader, và các `loader` admin có side effect như
    `releaseExpiredOrders` / `syncScheduledPosts` trong `admin/layout.tsx` và `admin/product-edit.tsx`);
    (b) cân nhắc kiểm tra `Origin`/`Sec-Fetch-Site` cho mọi request không phải GET/HEAD, đặt ở một chỗ
    trong `workers/app.ts` để không phải sửa từng route.
  - Cookie flags: `secure: import.meta.env.PROD` — xác nhận build production thực sự bật (kiểm tra sau
    `npm run build`), và `__Host-`/`Secure` cho cookie phiên admin nếu khả thi.
  - Session: TTL 14 ngày, xoá phiên hết hạn khi đăng nhập, thu hồi toàn bộ phiên khi đổi mật khẩu (đã có).
    Kiểm tra thêm: có nên rotate token sau đăng nhập lại, giới hạn số phiên, và `admin/logout.ts` chỉ
    nhận POST.
  - Open redirect: `next` ở `admin/login.tsx` lọc bằng `next.startsWith("/admin")` — kiểm tra các biến thể
    (`//`, `/\`, `\\`, `%2f%2f`, `/admin@evil.com`) và siết lại nếu cần. Tương tự `sanitizeRedirect`
    trong `app/routes/api.cart.ts`.
  (file dự kiến: `workers/app.ts`, `app/lib/auth.server.ts`, `app/routes/admin/login.tsx`,
  `app/routes/admin/logout.ts`, `app/routes/api.cart.ts`)

- [x] **T10: Rò rỉ dữ liệu qua loader / trang công khai**
  - Kiểm tra mọi loader storefront không trả dữ liệu nội bộ. Điểm cần xem: `cost_price`/`unit_cost`
    (`app/lib/cart.server.ts` trả `unitCost` xuống client; `PRODUCT_LIST_COLUMNS` và `getProductById`
    trong `app/lib/db.server.ts`), `profit` (`admin/order-detail.tsx` — chỉ admin, nhưng phụ thuộc T1),
    `adminName` trong `app/routes/shop/layout.tsx`.
  - `app/routes/shop/order-detail.tsx` trả thông tin thanh toán + PII — phụ thuộc T2.
  - `app/root.tsx` ErrorBoundary chỉ hiện stack khi `import.meta.env.DEV` (đã đúng) — xác nhận lại sau build.
  - `app/routes/sitemap.ts` và `robots.ts`: không liệt kê `/admin`, `/don-hang/*` (robots hiện đúng).
  - Kiểm tra trang chính sách `app/routes/shop/policy.tsx` không lộ email/điện thoại ngoài ý muốn và
    `params.slug` có allowlist.
  (file dự kiến: `app/lib/cart.server.ts`, `app/lib/db.server.ts`, `app/routes/shop/*.tsx`,
  `app/routes/sitemap.ts`, `app/routes/shop/policy.tsx`)

- [x] **T11: Phân quyền owner/staff**
  `app/lib/types.ts` khai báo `role: "owner" | "staff"` và `admin/layout.tsx` hiển thị nhãn
  "Chủ shop"/"Nhân viên", nhưng **không có chỗ nào kiểm tra role** — staff làm được mọi thứ owner làm
  (xem lợi nhuận, đổi mật khẩu, sửa cài đặt thanh toán, sửa API key, xuất CSV toàn bộ khách hàng).
  Việc cần làm: hoặc thêm `requireOwner` cho các trang nhạy cảm (`admin/cai-dat`, `admin/bao-cao`,
  `admin/don-hang/xuat-csv`), hoặc — nếu shop chỉ có một tài khoản — ghi rõ quyết định "chưa phân quyền"
  vào Dev notes và xoá phần UI gây hiểu sai. Không tự ý mở rộng phạm vi.
  (file dự kiến: `app/lib/auth.server.ts`, `app/routes/admin/settings.tsx`, `app/routes/admin/reports.tsx`,
  `app/routes/admin/orders-csv.ts`)

- [x] **T12: Cron, tích hợp ngoài & SSRF**
  - `workers/app.ts` `scheduled()` không cần auth (Cloudflare gọi nội bộ) — xác nhận **không** có route HTTP
    nào kích hoạt được cùng công việc đó mà không đăng nhập.
  - `app/lib/threads.server.ts`: `fetch` tới URL lấy từ response của Typefully (luồng upload media) →
    xác nhận chỉ chấp nhận host của Typefully/HTTPS, thêm timeout, và không log API key.
  - `app/lib/email.server.ts` / `telegram.server.ts`: kiểm tra `email_from`, `email_owner`,
    `telegram_chat_id` do admin nhập được validate (chống header/parameter injection) và lỗi trả về
    không in nguyên response chứa khoá.
  - Kiểm tra `vietQrImageUrl` trong `settings.server.ts` (đã `encodeURIComponent` — xác nhận `accountName`
    cũng an toàn khi đưa vào `URLSearchParams`).
  (file dự kiến: `workers/app.ts`, `app/lib/threads.server.ts`, `app/lib/email.server.ts`,
  `app/lib/telegram.server.ts`, `app/lib/settings.server.ts`)

- [x] **T13: Backup D1 & secrets nằm trong database**
  - `scripts/backup.mjs` ghi ra `backups/*.sql` (đã có trong `.gitignore`, quyền file mặc định).
    Kiểm tra: file được tạo với quyền hạn chế (`0600`), không có bản backup nào đang bị git track,
    cảnh báo trong output đã đủ rõ, `--keep` hoạt động đúng, và không in dữ liệu khách ra stdout.
  - **Quan trọng**: bảng `settings` chứa `typefully_api_key`, `resend_api_key`, `telegram_bot_token`
    dưới dạng plaintext (xem `SECRET_KEYS` trong `app/lib/settings.server.ts`), nên file backup .sql
    chứa luôn API key thật, không chỉ PII. Đánh giá và xử lý: hoặc loại các khoá bí mật khỏi backup,
    hoặc ghi cảnh báo rõ ràng, hoặc khuyến nghị chuyển hẳn sang `wrangler secret put` (env var đã được
    `getSecret` ưu tiên). Ghi quyết định vào Dev notes.
  - `scripts/create-admin.mjs`: kiểm tra `escape()` đủ an toàn cho tệp .sql tạm, file tạm có `mode 0o600`
    (hiện có) và được **xoá sau khi chạy** (hiện chưa xoá thư mục tạm — sửa).
  - `scripts/seed-orders.mjs`, `scripts/seed-images.mjs`, `scripts/screenshots.mjs`: xác nhận không chứa
    dữ liệu thật/khoá và không trỏ `--remote` theo mặc định.
  (file dự kiến: `scripts/backup.mjs`, `scripts/create-admin.mjs`, `app/lib/settings.server.ts`, `docs/`)

- [x] **T14: Dependency & cấu hình build**
  - Chạy `npm audit --omit=dev` và `npm audit`; ghi lại lỗ hổng, chỉ nâng cấp bản patch/minor an toàn.
    Không nâng major (React 19 / React Router 7.9.6 / Wrangler) trong task này.
  - Kiểm tra `wrangler.json`: `compatibility_date`, `nodejs_compat`, `observability`, `upload_source_maps`,
    binding `DB`/`IMAGES`, cron. Xác nhận không có route/domain nào vô tình mở, không có `vars` nhạy cảm.
  - Kiểm tra `vite.config.ts`, `react-router.config.ts`, `tsconfig*.json`: không expose biến server
    ra client (`define`, `import.meta.env` prefix), source map client không bật ở production.
  - Xác nhận `npm run check` (typegen + tsc + build + `wrangler deploy --dry-run`) pass sau toàn bộ thay đổi.
  (file dự kiến: `package.json`, `wrangler.json`, `vite.config.ts`, `react-router.config.ts`)

**Thứ tự phụ thuộc**: T1 → T2 → T3 (làm trước, độc lập với nhau nhưng ưu tiên theo mức độ).
T4–T14 làm được song song sau đó. T10 phụ thuộc kết quả T1 và T2. T14 chạy **cuối cùng**.

---

## Tiêu chí nghiệm thu
1. Không request HTTP nào (GET, POST, hay URL `.data` của single fetch, kể cả có `?_routes=`) đọc
   hoặc ghi được dữ liệu `/admin` khi thiếu cookie phiên hợp lệ → tất cả trả redirect về
   `/admin/dang-nhap` hoặc 401/403.
2. Không thể xem `/don-hang/:code` của đơn bất kỳ bằng cookie tự tạo; chỉ người vừa đặt hoặc vừa xác minh
   đúng số điện thoại mới xem được.
3. Có giới hạn tần suất ở đăng nhập admin và tra cứu đơn hàng; vượt ngưỡng trả 429 kèm thông báo tiếng Việt,
   và người dùng hợp lệ vẫn dùng bình thường.
4. Response HTML có đủ nhóm security header đã thống nhất; response ảnh có `nosniff`.
5. Không có secret nào xuất hiện trong `build/client/**`, trong loader data, hay trong log.
6. Upload chỉ nhận ảnh thật (kiểm magic bytes), `Content-Type` lưu vào R2 do server quyết định,
   `/anh/*` chỉ phục vụ prefix hợp lệ.
7. CSV xuất ra không còn ô bắt đầu bằng `= + - @` chưa vô hiệu hoá; email/Telegram/XML đều escape đúng.
8. Mọi giá trị người dùng nhập vào SQL đều qua `.bind()`; không đoạn nội suy nào nhận input thô.
9. Luồng nghiệp vụ không hồi quy: thêm giỏ → áp mã giảm giá → đặt hàng → xem đơn → tra cứu đơn → đánh giá;
   đăng nhập admin → CRUD sản phẩm + ảnh → đổi trạng thái đơn → xuất CSV → đổi cài đặt.
10. `npm run check` pass. Mỗi task có kết luận rõ trong Dev notes: **"đã tìm thấy + đã sửa"** hoặc
    **"đã kiểm tra, không có vấn đề"** (kèm cách kiểm tra).

## Kế hoạch test (cho tester)
Chuẩn bị: `npm run db:migrate && npm run db:seed && npm run db:seed-orders`, tạo admin bằng
`ADMIN_PASSWORD='...' node scripts/create-admin.mjs test "Tester"`, rồi `npm run dev`.
Dùng `curl -i` (không kèm cookie) cho các ca bảo mật, browser cho hồi quy UI.
Không chạy bất kỳ lệnh nào có `--remote`.

**A. Authz admin (T1)** — với **không** cookie:
- GET `/admin`, `/admin/don-hang`, `/admin/don-hang/1`, `/admin/don-hang/1/phieu`,
  `/admin/don-hang/xuat-csv`, `/admin/khuyen-mai`, `/admin/danh-gia`, `/admin/bao-cao`,
  `/admin/cai-dat`, `/admin/san-pham`, `/admin/san-pham/moi`, `/admin/san-pham/1`
  → phải redirect `/admin/dang-nhap`, **không** có nội dung dữ liệu trong body.
- POST vào từng route trên với payload thật, ví dụ:
  - `/admin/san-pham` body `intent=discontinue&productId=1` → sản phẩm 1 **không** bị đổi status
    (kiểm tra bằng `npm run db:studio "SELECT status FROM products WHERE id=1"`).
  - `/admin/don-hang/1` body `intent=mark-paid` → `payment_status` không đổi.
  - `/admin/don-hang/1` body `intent=note&adminNote=hacked` → `admin_note` không đổi.
  - `/admin/khuyen-mai` body tạo mã mới → không có dòng mới trong `discount_codes`.
  - `/admin/danh-gia` body ẩn/hiện đánh giá → `product_reviews` không đổi.
  - `/admin/san-pham/1` body `intent=post-threads` → không gọi API ngoài, không thêm dòng `social_posts`.
- Thử URL single fetch: `/admin/don-hang/1.data`, `/admin/don-hang/1.data?_routes=routes/admin/order-detail`,
  `/admin.data?_routes=routes/admin/dashboard` → không trả dữ liệu đơn/thống kê.
- Sau khi đăng nhập: tất cả các trang trên hoạt động bình thường (hồi quy).

**B. IDOR đơn hàng (T2)**:
- Đặt một đơn qua UI, ghi lại mã (vd `LUMI12345`). Mở tab ẩn danh, GET `/don-hang/LUMI12345` → phải bị
  đẩy về `/tra-cuu-don-hang`.
- Tự tạo cookie `lumi_orders` bằng base64 của `["LUMI12345"]` (định dạng cookie cũ) và gửi kèm
  → phải **không** xem được đơn.
- Tra cứu đúng mã + đúng SĐT → xem được; sai SĐT → thông báo chung, status 404.
- Giỏ hàng vẫn hoạt động sau thay đổi cookie (thêm/sửa/xoá dòng, mã giảm giá còn nhớ khi qua trang thanh toán).

**C. Rate limit (T3)**: POST `/admin/dang-nhap` sai mật khẩu liên tiếp (≥ ngưỡng) → 429; POST
`/tra-cuu-don-hang` sai liên tiếp → 429; sau đó đăng nhập đúng vẫn được (sau thời gian chờ đã ghi trong Dev notes).

**D. Headers (T4)**: `curl -I` trang chủ, `/admin/dang-nhap`, `/anh/<key>` → kiểm tra đủ header đã thống nhất.
Mở trang chủ + trang sản phẩm + trang admin trong browser, **console không có lỗi CSP**, hydration bình thường.

**E. Upload & ảnh (T6)**: đăng nhập admin, thử upload
(1) ảnh JPG thật → OK; (2) file `.txt` đổi tên `.jpg` với `Content-Type: image/jpeg` → bị từ chối;
(3) file > 5MB → bị từ chối. GET `/anh/../../etc/passwd`, `/anh/settings/`, `/anh/<key-không-tồn-tại>`
→ 404, không lộ thông tin bucket.

**F. CSV & XSS (T8)**: tạo đơn có tên khách `=cmd|' /C calc'!A0` và ghi chú `+1+2`, xuất CSV
→ các ô đó đã được vô hiệu hoá công thức. Kiểm tra `/sitemap.xml` well-formed với sản phẩm có ký tự `&`.
Tạo sản phẩm tên `<img src=x onerror=alert(1)>` → hiển thị dạng văn bản ở storefront và admin.

**G. Redirect & CSRF (T9)**: `/admin/dang-nhap?next=//evil.com`, `?next=/\evil.com`,
`?next=https://evil.com`, `?next=/admin@evil.com` → sau đăng nhập luôn ở lại domain hiện tại.
GET `/admin/dang-xuat` → không đăng xuất (phải là POST). POST từ origin khác (nếu T9 thêm kiểm tra
Origin) → bị từ chối.

**H. Hồi quy nghiệp vụ**: chạy hết luồng ở tiêu chí nghiệm thu #9. Chạy `npm run check`.

Báo cáo: mỗi ca ghi PASS/FAIL, lệnh đã dùng và output ngắn. FAIL thì ghi rõ route + payload để dev lặp lại.

## Rủi ro & giả định
- **Giả định**: chỉ có một loại người dùng đăng nhập (admin); khách mua hàng không có tài khoản.
- **Giả định**: CLAUDE.md đang là bản mẫu chưa điền, nên quy ước code suy ra từ codebase:
  logic server nằm trong `app/lib/*.server.ts`, route dùng loader/action của React Router,
  truy vấn D1 luôn qua prepared statement + `.bind()`, comment tiếng Việt giải thích "vì sao".
  Giữ đúng phong cách này.
- **Rủi ro cao — T2 làm mất trạng thái người dùng**: ký cookie sẽ làm cookie `lumi_orders`
  (và có thể `lumi_cart`) hiện có trên máy khách trở thành không hợp lệ. Phải xử lý mềm
  (coi như rỗng, không văng 500) và ghi rõ ảnh hưởng vào Dev notes.
- **Rủi ro — T2/T3 cần secret/bảng mới**: cần `.dev.vars` ở local và `wrangler secret put` khi deploy.
  Nếu thiếu, dev phải chọn fail-closed và nói rõ, không âm thầm tắt bảo vệ.
- **Rủi ro — T4 CSP phá hydration** của React Router/Tailwind v4. Nếu không làm được CSP chặt,
  dùng `Report-Only` và ghi lý do; không hy sinh chức năng.
- **Rủi ro — T3 rate limit bằng D1** thêm một truy vấn ghi vào mỗi lần đăng nhập/tra cứu (ảnh hưởng nhỏ).
- **Rủi ro — T1 sửa nhiều file** (12+ route admin), dễ bỏ sót một action. Dev nên thêm helper dùng chung
  và tester phải thử **từng** route trong mục A.
- **Chưa có test runner tự động**: nghiệm thu dựa vào `curl` thủ công + `npm run check`; kết quả phụ thuộc
  độ tỉ mỉ của tester.
- Không thể xác minh cấu hình phía Cloudflare (WAF, custom domain, quyền bucket R2, secret đã đặt chưa)
  từ trong repo → những điểm này chỉ ghi khuyến nghị, không tính là FAIL.

## Review findings (reviewer điền) — Vòng 1: CHANGES REQUESTED

Tổng: 15 finding — 1 Critical, 6 Warning, 8 Suggestion. Xác nhận T1/T2/T3/T9 đúng như Dev notes claim
(đã đối chiếu diff), không có timing attack, race condition, hay bypass Origin check.

### Critical (BẮT BUỘC sửa trước khi APPROVE)
1. **Rò rỉ `unit_cost` (giá nhập) + `admin_note` xuống client ở trang khách xem đơn** —
   `app/routes/shop/order-detail.tsx:49-66` trả thẳng `order` từ `getOrderByCode` (`db.server.ts:571-580`):
   `items` từ `getOrderItems` = `SELECT * FROM order_items` (có `unit_cost`, `db.server.ts:595-604`),
   `orders` là `SELECT *` (có `admin_note` nội bộ). Lộ qua view-source / `/don-hang/<code>.data`.
   Cùng lớp lỗi T10 đã sửa ở cart/checkout/product-detail nhưng bỏ sót route này → T10 chưa đạt tiêu chí
   nghiệm thu #10 ("mọi loader storefront không trả dữ liệu nội bộ").
   Cách sửa: thêm `toPublicOrder(order)` (bỏ `admin_note` và `unit_cost` từng item) trong
   `app/lib/order.server.ts` hoặc `cart.server.ts`, áp cho loader của `shop/order-detail.tsx`; giữ
   `getOrderByCode` đầy đủ cho `admin/order-detail.tsx` và `notifyNewOrder`.
   Kiểm chứng: `curl -b <cookie> .../don-hang/<code>.data | grep -E "unit_cost|admin_note"` phải rỗng.

### Warning (nên sửa trong vòng này nếu còn ngân sách)
2. Rate limit (T3) chỉ theo IP, thiếu khoá theo username/mã đơn như plan yêu cầu — brute force phân tán
   (IPv6 rotation) không bị chặn ở mức tài khoản. Thêm lần gọi thứ 2: `admin-login-user` key=username,
   `order-lookup-code` key=mã đơn.
3. `checkRateLimit` không fail-soft ở `checkout.tsx:98`, `api.cart.ts:23` — lỗi ghi D1 (hoặc migration
   0007 chưa áp ở production) sẽ làm sập luồng mua hàng (500). Bọc try/catch: fail-open cho
   cart-write/checkout-order, fail-closed cho admin-login. **Nhắc khi deploy: phải chạy migration 0007
   trên D1 production trước, không thì 4 route liệt kê sẽ 500.**
4. `COOKIE_SECRET` không kiểm tra độ mạnh (`recent-orders.server.ts:getCookieSecret`) — chấp nhận cả
   chuỗi placeholder mẫu trong `.dev.vars.example`. Từ chối nếu `length < 32` hoặc khớp placeholder.
5. `image/svg+xml` được phép ở MỌI prefix trong `app/routes/anh.ts:33-39` — nếu SVG lọt vào
   `products/`/`settings/` (dù hiện chưa có đường ingress) sẽ là stored XSS trên origin của shop
   (`nosniff` không chặn SVG chạy script). Chỉ cho phép `image/svg+xml` khi `key.startsWith("demo/")`.
6. T12 chưa đạt "chỉ chấp nhận host của Typefully" — `isSafeExternalUrl` là blocklist theo pattern, không
   chặn DNS rebinding, và `fetch` mặc định follow redirect (302 có thể đi vòng qua kiểm tra). Đề nghị:
   allowlist host + `redirect: "manual"` ở lượt PUT ảnh trong `threads.server.ts`.
7. `rate-limit.server.ts:42-47` chạy `DELETE` dọn dẹp ở MỌI lần gọi — hot path `/api/gio-hang` (60/phút)
   bị khuếch đại ghi D1. Dọn theo xác suất (~1%) hoặc gộp vào cron 15 phút đã có.

### Đánh giá 2 phát hiện của tester
8. `Retry-After` rơi mất ở login/order-lookup — xác nhận đúng, không nghiêm trọng, không phá tiêu chí #3
   → ghi nhận known issue, không chặn release.
9. Sản phẩm "mồ côi" khi ảnh bị từ chối giữa lúc upload nhiều ảnh — xác nhận đúng, có trước T6, T6 làm dễ
   xảy ra hơn. Known issue, nên xếp task riêng (data integrity, chỉ admin gây ra).

### Suggestion (không bắt buộc vòng này)
10. `MAX_IMAGES_PER_SUBMIT` kiểm tra sau `request.formData()` — vẫn buffer RAM trước khi chặn.
11. `discounts.tsx:52` — `Number.parseInt("5abc")`=5 vẫn được nhận, nên validate bằng regex trước.
12. 3 chỗ cast `env as unknown as Record<string, unknown>` không còn cần thiết sau khi
    `worker-configuration.d.ts` đã khai `COOKIE_SECRET`.
13. CSP Report-Only thiếu `report-uri`/`report-to` nên không thu được report nào; `script-src
    'unsafe-inline'` khiến enforce cũng không chặn XSS.
14. `hasTrustedOrigin` có thể siết thêm bằng `Sec-Fetch-Site`.
15. `admin/settings.tsx:34-40` — `requireAdmin` nằm trong `Promise.all`, nên các query khác vẫn chạy
    trước khi redirect được ném (không lộ dữ liệu, nhưng nên `await` riêng trước).
16. `db/migrations/0007_rate_limit.sql` — `idx_rate_limits_lookup` trùng index UNIQUE tự động, bỏ được.

**Verdict: CHANGES REQUESTED.** Bắt buộc sửa #1. Khuyến nghị sửa thêm #2-7 trong cùng vòng. #8-16 để lại
thành known issue / task riêng.

## Dev notes (dev điền)

Đã hoàn thành 14/14 task. `npm run check` PASS (typegen + tsc -b + react-router build + wrangler deploy --dry-run).
Chuẩn bị môi trường test: cần file `.dev.vars` ở gốc repo với `COOKIE_SECRET=<chuỗi ngẫu nhiên>` (xem
`.dev.vars.example`) — thiếu biến này thì `/don-hang/:code` và `/tra-cuu-don-hang` sẽ fail-closed
(không xem được đơn nào, tra cứu trả lỗi 503), **không phải bug**.

### T1 (CRITICAL) — đã tìm thấy + đã sửa
Đúng như plan mô tả: `dashboard.tsx`, `products.tsx` (loader+action), `customers.tsx`, `discounts.tsx`
(loader+action), `order-detail.tsx` (loader+action), `order-slip.tsx`, `orders.tsx`, `product-edit.tsx`
(loader+action), `product-new.tsx` (loader+action), `reports.tsx`, `reviews.tsx` (loader+action) đều
THIẾU `requireAdmin`. Đã thêm `await requireAdmin(db, request)` vào đầu mọi loader/action, đổi signature
loader để nhận `request` ở các route thiếu (order-detail, order-slip, discounts, product-new).
`layout.tsx`, `settings.tsx`, `orders-csv.ts` đã có sẵn — không đổi. `login.tsx`/`logout.ts` giữ nguyên
theo yêu cầu.
File đã sửa: toàn bộ `app/routes/admin/*.tsx` (trừ layout.tsx, login.tsx, settings.tsx) + `logout.ts` không đổi.
Kiểm chứng: `npm run dev`, tạo admin `ADMIN_PASSWORD='Lumi@2026' node scripts/create-admin.mjs thuy "Chi Thuy"`,
rồi chạy script `curl` cho toàn bộ 13 route GET (mục A trong Kế hoạch test) → tất cả 302 về
`/admin/dang-nhap?next=...`. POST `discontinue` vào sản phẩm 1 không cookie → `SELECT status FROM
products WHERE id=1` vẫn `active`. POST tạo mã giảm giá `HACK10` không cookie →
`SELECT COUNT(*) FROM discount_codes WHERE code='HACK10'` = 0. `.data?_routes=routes/admin/order-detail`
trả về turbo-stream redirect tới `/admin/dang-nhap`, không có dữ liệu đơn. Sau khi login (cookie hợp lệ)
mọi route trên trả 200 bình thường — không hồi quy.

### T2 (HIGH) — đã tìm thấy + đã sửa
`lumi_orders` không ký đúng như plan mô tả. Đã ký bằng `secrets` của react-router `createCookie`, đọc
secret `COOKIE_SECRET` từ `context.cloudflare.env` (không có trong `wrangler.json` `vars` vì là bí mật).
Cookie được tạo lười (lazy, cache theo giá trị secret) vì Workers không có env ở phạm vi module — chỉ có
trong loader/action. **Fail-closed**: thiếu secret → `readRecentOrders` trả rỗng, `rememberOrder` trả
`null`. Nơi gọi phải xử lý `null` mềm: `checkout.tsx` vẫn tạo đơn xong, chỉ bỏ qua việc set cookie ghi nhớ
(khách mất tiện ích tự động xem lại đơn, vẫn tra cứu được bằng SĐT); `order-lookup.tsx` trả lỗi 503 rõ
ràng (chưa tạo cookie thật nào nên không có gì để mất). `order-detail.tsx` (loader + action) coi thiếu
secret như không có quyền xem — an toàn theo hướng chặn.
Đã rà `lumi_cart`/`lumi_discount` (`cart.server.ts`): **kết luận không ký** — cookie chỉ chứa
`{variantId, quantity}` hoặc một chuỗi mã giảm giá; `sanitize()` loại bỏ giá trị hỏng, và giá/tồn
kho/điều kiện mã luôn tính lại từ D1 ở mọi lần đọc (`loadCartDetails`, `validateDiscountCode`) — sửa
cookie này chỉ cho phép tự thao túng giỏ của chính mình, không có IDOR/PII, không khác gì dùng UI.
Nạp secret: dev → thêm `COOKIE_SECRET=...` vào `.dev.vars` (đã tạo `.dev.vars.example` làm mẫu, và đã tự
tạo `.dev.vars` thật ở máy này để test — **không commit**); production → `wrangler secret put COOKIE_SECRET`.
File đã sửa: `app/lib/recent-orders.server.ts` (viết lại), `app/routes/shop/checkout.tsx`,
`app/routes/shop/order-lookup.tsx`, `app/routes/shop/order-detail.tsx`, `.dev.vars.example` (mới).
Kiểm chứng: đặt đơn qua UI thật (`LUMI51292`) → cookie `Set-Cookie: lumi_orders=<base64>.<hmac>`. Gửi cookie
giả `lumi_orders=$(base64 '["LUMI51292"]')` (định dạng cũ, không có phần `.<hmac>`) → route redirect về
`/tra-cuu-don-hang`, không xem được đơn. Tra cứu đúng mã+SĐT → xem được (200); cookie ký hợp lệ dùng lại
được luôn. Ảnh hưởng khi deploy: cookie `lumi_orders` cũ trên máy khách (trước khi có secret) sẽ không
parse được nữa → coi như rỗng (không lỗi 500), khách chỉ cần tra cứu lại bằng SĐT một lần.

### T3 (HIGH) — đã tìm thấy + đã sửa
Không có rate limit ở đâu cả, đúng như plan. Chọn D1 (không thêm dependency, không dùng Cloudflare Rate
Limiting rules vì không cấu hình được từ trong repo) — bảng mới `rate_limits` (migration
`db/migrations/0007_rate_limit.sql`): đếm theo cửa sổ cố định (fixed window) cho cặp (scope, identifier).
Helper `app/lib/rate-limit.server.ts` (`checkRateLimit`, `clientIp` dùng header `CF-Connecting-IP`,
`rateLimitMessage` tiếng Việt). Ngưỡng áp dụng:
- `admin/login.tsx`: 8 lần/5 phút theo IP, kiểm tra TRƯỚC khi chạy PBKDF2 (chặn sớm, đỡ tốn CPU).
- `shop/order-lookup.tsx`: 10 lần/5 phút theo IP.
- `shop/checkout.tsx`: 8 đơn/10 phút theo IP (chặn spam đơn → spam email/Telegram).
- `api/gio-hang` (`api.cart.ts`, ưu tiên thấp theo plan): 60 lần/phút theo IP.
Vượt ngưỡng → 429 kèm `Retry-After` + thông báo tiếng Việt, không đụng tới luồng còn lại (không tạo bảng
ghi log riêng, tự dọn cửa sổ cũ ngay trong `checkRateLimit`).
File đã sửa: `app/lib/rate-limit.server.ts` (mới), `db/migrations/0007_rate_limit.sql` (mới),
`app/routes/admin/login.tsx`, `app/routes/shop/order-lookup.tsx`, `app/routes/shop/checkout.tsx`,
`app/routes/api.cart.ts`.
Kiểm chứng: `npm run db:migrate` áp migration 0007 thành công (local). POST sai mật khẩu liên tiếp vào
`/admin/dang-nhap` → 401 các lần đầu, từ lần thứ 5 trở đi (tính cả các lần login test trước đó trong
cùng cửa sổ 5 phút) → 429. POST sai liên tiếp vào `/tra-cuu-don-hang` → 404 (không khớp) rồi 429 sau
~10 lần. Đăng nhập đúng vẫn hoạt động ngoài cửa sổ chặn — đã login thành công nhiều lần trong lúc test
các task khác (cửa sổ 5 phút trôi qua là tự hết chặn, không cần thao tác gì thêm).

### T4 — đã tìm thấy + đã sửa
`entry.server.tsx` chỉ set `Content-Type`, `workers/app.ts` không set header bảo mật nào — đúng plan.
Thêm một chỗ duy nhất: bọc `fetch()` trong `workers/app.ts` (`withSecurityHeaders`), áp cho MỌI response
(HTML lẫn resource route như `/anh/*`, CSV, sitemap) mà không cần sửa từng route. Header cứng luôn thêm:
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`,
và `Strict-Transport-Security` (chỉ khi request là https, tự bỏ ở dev http://localhost).
**CSP để dạng `Content-Security-Policy-Report-Only`, không enforce** — lý do: React Router chèn
`<script>` inline chứa dữ liệu hydrate (xác nhận bằng `curl http://localhost:5173/ | grep script`, thấy
nhiều `<script>` không có nonce trong bản framework hiện tại), và trang quản trị (`dashboard.tsx`,
`reports.tsx`) dùng `style={{width: ...}}` inline cho thanh doanh thu — chặn cứng `script-src`/`style-src`
sẽ trắng trang admin và hỏng hydration storefront. Report-Only vẫn khai `frame-ancestors 'none'`,
`img-src` cho phép `img.vietqr.io` (mã QR chuyển khoản), `style-src`/`font-src` cho phép
`fonts.googleapis.com`/`fonts.gstatic.com`.
`app/routes/anh.ts` đã thêm `X-Content-Type-Options: nosniff` riêng (phòng khi header chung ở
`workers/app.ts` vì lý do gì không chạy tới) — trùng với header chung, không sao vì `withSecurityHeaders`
không ghi đè header đã có.
File đã sửa: `workers/app.ts`, `app/routes/anh.ts` (phần nosniff, phần còn lại của anh.ts xem T6).
Kiểm chứng: `curl -I http://localhost:5173/`, `/admin/dang-nhap` → đủ 4 header cứng + CSP Report-Only.
HSTS không xuất hiện ở dev (đúng vì http, không phải https) — cần kiểm tra lại trên domain https thật.
Mở trang chủ/trang sản phẩm/trang admin bằng browser thật (không làm được trong môi trường agent này) —
đề nghị tester mở DevTools Console kiểm tra không có lỗi CSP chặn hydration (Report-Only chỉ log warning,
không chặn gì nên về lý thuyết không thể "hỏng" chức năng — nhưng cần tester xác nhận bằng mắt).

### T5 — đã kiểm tra, không có vấn đề
- Grep toàn repo (`sk_`, `re_`, `bot[0-9]+:`, `Bearer `, `api[_-]?key=`, `password=`) trong mã nguồn: chỉ
  khớp comment hướng dẫn dùng biến môi trường trong `scripts/create-admin.mjs`, không có secret cứng.
- `npm run build` rồi grep `build/client/**` cho `typefully_api_key`, `resend_api_key`,
  `telegram_bot_token`, và cả giá trị `COOKIE_SECRET` thật đang dùng ở máy này: chỉ khớp trong
  `settings-*.js` dưới dạng thuộc tính `name`/`htmlFor` của `<input>` (tên field HTML, không phải giá trị
  bí mật) — xác nhận bằng `grep -o ".\{60\}typefully_api_key.\{60\}"`, thấy rõ đó là chuỗi
  `label htmlFor="typefully_api_key"`.
- `app/lib/threads.ts`, `app/lib/images.ts` (dùng chung client/server): không `import` bất kỳ module
  `*.server.ts` nào (`grep "^import"` rỗng/chỉ import type nội bộ).
- Mọi nơi gọi `getSecret`/`hasSecret` đều ở trong loader/action (server), và loader chỉ trả `apiKeySet`/
  `hasApiKey` dạng boolean — không route nào return giá trị secret thật ra `data()`.
- `wrangler.json`: `vars` chỉ có `SHOP_NAME`, `SHOP_TAGLINE` (công khai) — không đổi.
- `console.log`/`console.error` trong `notify.server.ts`, `email.server.ts`, `telegram.server.ts`,
  `threads.server.ts`, `workers/app.ts`: chỉ có 2 dòng `console.log` trong cron (`workers/app.ts`) đếm số
  lượng (`đã huỷ và hoàn kho N đơn`, `đã cập nhật trạng thái N bài đăng`) — không có PII. File log khác
  không có `console.*` nào.
- `.gitignore` đã che `.env*`, `.dev.vars*` (trừ `.example`), `/backups/`; `git status`/`git ls-files`
  xác nhận không có `.env`/`.dev.vars`/file trong `backups/` nào bị track.
- Phát hiện ngoài lề (không phải lỗ hổng): `npm run build` copy `.dev.vars` vào `build/server/.dev.vars`
  (hành vi của `@cloudflare/vite-plugin` để `wrangler dev`/preview đọc secret local nhất quán). Đã xác
  nhận `build/server/wrangler.json` có `assets.directory: "../client"` — KHÔNG trỏ vào `build/server`,
  và `main: index.js` + `no_bundle: true` nên `wrangler deploy` chỉ đọc theo module graph từ `index.js`,
  không có gì `import` `.dev.vars` → tệp này không lên production, chỉ là rác cục bộ trong thư mục
  `build/` (đã gitignore). Ghi lại để tester/người sau biết, không cần sửa.

### T6 — đã tìm thấy + đã sửa
- `images.server.ts`: chỉ tin `file.type` do client khai — đã thêm dò magic bytes (`sniffImageType`,
  đọc 16 byte đầu) cho JPEG/PNG/WebP/AVIF; `Content-Type` lưu vào R2 giờ luôn lấy từ kết quả dò, không
  còn dùng `file.type`. Test thật: file `.txt` đổi tên `.jpg` + header `Content-Type: image/jpeg` giả
  → bị từ chối ("Chỉ hỗ trợ ảnh..."); file có magic bytes JPEG thật (dù nội dung còn lại là random bytes)
  → được nhận.
- `product-form.server.ts`: thêm `MAX_IMAGES_PER_SUBMIT = 12`, chặn trước khi loop upload nếu
  `form.getAll("images")` vượt ngưỡng.
- `app/routes/anh.ts`: viết lại — chỉ phục vụ key có prefix `products/`, `settings/`, `demo/` (thêm
  `demo/` so với plan vì đó là ảnh minh hoạ do `scripts/seed-images.mjs` tự sinh khi seed, không phải
  input người dùng — nếu bỏ prefix này thì toàn bộ ảnh demo vỡ sau khi `npm run db:seed`); từ chối key có
  `..`, ký tự điều khiển, hoặc dài hơn 200 ký tự → 404. Kiểm thêm `Content-Type` lưu trong R2 phải nằm
  trong danh sách ảnh cho phép (jpeg/png/webp/avif + `svg+xml` CHỈ vì ảnh demo là SVG do code tự sinh,
  không phải upload thật — luồng upload thật (`uploadProductImage`) không cho SVG nên khách/admin không
  tự đưa SVG vào bucket qua ứng dụng được); object không khớp danh sách → 404 kèm
  `Content-Disposition: attachment`. Thêm `X-Content-Type-Options: nosniff` (dù đã có ở tầng chung T4).
- `anh-mac-dinh.ts`: đã kiểm tra — `params.kind` được ép qua allowlist `kind in SHAPES` trước khi dùng,
  toàn bộ dữ liệu render SVG (`LABELS`, `PALETTES`, `SHAPES`) đều là hằng số nội bộ, không nội suy input
  người dùng → không có vấn đề, không sửa.
- Đường xoá ảnh trong `product-form.server.ts` (`saveImages`): đã kiểm tra — vẫn scope theo
  `WHERE id = ?1 AND product_id = ?2` — giữ nguyên như plan xác nhận.
File đã sửa: `app/lib/images.server.ts`, `app/lib/product-form.server.ts`, `app/routes/anh.ts`.
Kiểm chứng thêm: `GET /anh/../../etc/passwd`, `/anh/settings/`, `/anh/backup.sql` (key lạ không tồn tại,
không đúng prefix) → đều 404, không lộ gì về cấu trúc bucket. `GET /anh/demo/p1-a.svg` (ảnh seed thật)
→ 200, `Content-Type: image/svg+xml`. Upload ảnh > 5MB → vẫn bị chặn như cũ (logic cũ không đổi).

### T7 — đã tìm thấy + đã sửa (một phần) / đã kiểm tra phần còn lại
- Rà toàn bộ `db.server.ts`, `order.server.ts`, `reviews.server.ts`, `threads.server.ts`,
  `settings.server.ts`: mọi nội suy chuỗi vào SQL (`where`, `orderBy`, `groupClause`, `statusClause`,
  `activeClause`, `keepClause`, `holes`) đều lấy từ allowlist (`SORT_SQL`/`SORT_PARAM_TO_SQL` trong
  `products.tsx`, tham số nội bộ như `includeHidden`) hoặc do chính hàm sinh (số lượng `?N` theo độ dài
  mảng) — **không có chỗ nào truyền `sort`/tên cột thô từ request**. Xác nhận `SORT_PARAM_TO_SQL` map
  cứng 4 giá trị, fallback `"newest"` nếu không khớp → không route nào lộ SQL injection qua sort.
  → đã kiểm tra, không có vấn đề (không sửa).
- **Đã sửa**: `sizes`/`colors` trong `products.tsx` → `buildProductWhere` (`db.server.ts`) giờ
  `.slice(0, MAX_FACET_VALUES=20)` trước khi build `IN (...)`, chặn URL lặp `&size=` hàng nghìn lần làm
  vượt giới hạn tham số D1 gây lỗi 500.
- **Đã sửa**: `orders-csv.ts` dựng `IN (...)` với tới 5000 id — đã chia lô `CHUNK_SIZE = 100` (nhiều lượt
  query gộp `Map` kết quả) thay vì một câu duy nhất.
- **Đã sửa**: `reviews.server.ts` — `submitReview` chưa giới hạn độ dài `content`, đã thêm
  `MAX_REVIEW_CONTENT_LENGTH = 2000` (rating 1-5 đã có sẵn, `authorName` đã cắt 60 ký tự sẵn — giữ nguyên).
- **Đã sửa**: `checkout.tsx` — chỉ có kiểm tra độ dài TỐI THIỂU, đã thêm tối đa: `customerName` ≤100,
  `customerAddress` ≤300, `note` ≤500, `customerEmail` ≤200 (kèm `maxLength` phía client cho UX, không
  thay layout). Validate ở server là chốt chặn thật, client chỉ hỗ trợ.
- **Đã sửa**: `discounts.tsx` — thêm kiểm tra `startsAt <= endsAt` (so sánh chuỗi "YYYY-MM-DD" là đủ) và
  `usageLimit` phải là số nguyên > 0 nếu có nhập (trước đó `Number.parseInt(...) || null` âm thầm nhận
  giá trị âm/0 thành `null` mà không báo lỗi).
- `format.ts` (`normalizePhone`, `isValidPhone`, `parseVnd`, `slugify`): đã đọc kỹ — thuần xử lý chuỗi,
  không có injection, `slugify` đã cắt 80 ký tự → không sửa.
- Giá tiền: xác nhận lại `createOrder`/`loadCartDetails` luôn tính subtotal/discount/shipping/total từ
  D1 — không route nào nhận `price`/`total` từ form. Không sửa.
File đã sửa: `app/lib/db.server.ts`, `app/routes/admin/orders-csv.ts`, `app/lib/reviews.server.ts`,
`app/routes/shop/checkout.tsx`, `app/routes/admin/discounts.tsx`.
Kiểm chứng: POST mã giảm giá với `startsAt=2026-05-01&endsAt=2026-01-01` → 400 "Ngày kết thúc phải sau
ngày bắt đầu", không có dòng mới trong `discount_codes`. `npx tsc -b` sạch sau mỗi thay đổi.

### T8 — đã tìm thấy + đã sửa (CSV) / đã kiểm tra phần còn lại
- **Đã sửa — CSV formula injection**: `orders-csv.ts` `escapeCell` giờ thêm tiền tố `'` khi ô bắt đầu
  bằng `=`, `+`, `-`, `@`, tab hoặc CR trước khi bọc dấu ngoặc kép. Test thật: đặt đơn với tên
  `=cmd|' /C calc'!A0` và ghi chú `+1+2` qua checkout thật → xuất CSV, hai ô đó ra
  `"'=cmd|' /C calc'!A0"` và `"'+1+2"` — Excel/Sheets sẽ hiển thị nguyên văn, không chạy công thức.
- `email.server.ts`: đọc toàn bộ file — mọi giá trị từ khách/đơn (tên, SĐT, địa chỉ, ghi chú, mã giảm
  giá, số tài khoản/tên chủ TK) đều qua `escapeHtml` trước khi nội suy vào email HTML. Chỗ không escape
  (`order.order_code`, `formatVnd(...)`, `PAYMENT_METHOD_LABEL[...]`, `qr` URL) đều là dữ liệu server
  sinh/định dạng số/enum cố định, không phải input thô của khách → an toàn. → không sửa.
- `telegram.server.ts`: tương tự, toàn bộ giá trị người dùng đều qua `escapeHtml` riêng của file này
  (chặn `&`, `<`, `>` — đủ cho tập thẻ HTML hạn chế Telegram cho phép). → không sửa.
- `threads.server.ts`: `buildCaption` chỉ ghép chuỗi thuần (không phải HTML), và caption được gửi lên
  Typefully qua `JSON.stringify(...)` (xem `createThreadsDraft`) — JSON.stringify tự escape mọi ký tự
  đặc biệt, không thể phá cấu trúc JSON. Dữ liệu nội suy (`product.name`, `.description`, ...) là do
  ADMIN nhập khi tạo sản phẩm, không phải khách hàng → rủi ro thấp, và đã được JSON escape đúng cách.
  → không sửa.
- `sitemap.ts`: đã có `escapeXml` áp cho `origin + entry.path`; slug luôn qua `slugify()` (chỉ a-z0-9,
  gạch ngang) nên thực tế không bao giờ chứa ký tự cần escape, nhưng hàm escape vẫn ở đó làm lưới an
  toàn. → không sửa.
File đã sửa: `app/routes/admin/orders-csv.ts`.

### T9 — đã tìm thấy + đã sửa
- **(a) GET đổi trạng thái**: `admin/logout.ts` `loader()` chỉ `redirect("/admin")`, không đăng xuất —
  đã đúng từ trước, không sửa. `api.cart.ts` `loader()` chỉ redirect về `/gio-hang`, không side effect —
  đã đúng, không sửa. `releaseExpiredOrders`/`syncScheduledPosts` chạy trong GET loader
  (`admin/layout.tsx`, `admin/product-edit.tsx`, và các trang storefront) — đây LÀ side effect trên GET,
  nhưng không có tham số nào từ kẻ tấn công ảnh hưởng tới việc chạy (không nhận input), hành vi idempotent
  (huỷ đơn đã quá hạn theo thời gian thật, đồng bộ trạng thái đọc từ Typefully) và cùng việc cron đã làm
  mỗi 15 phút — không phải lỗ hổng CSRF khai thác được, chỉ là "GET có side effect nhẹ" chấp nhận được.
  → không sửa (ghi nhận, không tính FAIL).
- **(b) Origin check — đã thêm mới**: `workers/app.ts` `hasTrustedOrigin()` — mọi request KHÔNG phải
  GET/HEAD/OPTIONS mà có header `Origin` KHÁC host của chính request đó → trả 403 ngay, trước khi vào
  React Router. Không chặn khi THIẾU header `Origin` (một số client hợp lệ không luôn gửi) — chỉ chặn khi
  gửi *và* sai, để không phá luồng mua hàng thật (SameSite=Lax đã là lớp chặn chính, đây chỉ là thêm).
- **(c) Cookie flags**: `secure: import.meta.env.PROD` đã đúng từ trước cho mọi cookie — xác nhận qua
  build (giữ nguyên hành vi dev/prod), không sửa.
- **(d) `__Host-` prefix — đã thêm mới**: `auth.server.ts` — tên cookie phiên admin đổi thành
  `__Host-lumi_admin_session` **CHỈ ở production** (`import.meta.env.PROD`), vì `__Host-` bắt buộc
  `Secure=true` mà ở dev (http://localhost) cookie không thể Secure → nếu đổi tên cả ở dev, browser sẽ
  âm thầm từ chối cookie và đăng nhập admin sẽ hỏng hoàn toàn ở dev. Chỉ có một nơi tham chiếu tên cookie
  (`auth.server.ts`), không có route/script nào đọc cookie theo tên cứng → đổi an toàn, tester chạy dev
  vẫn thấy tên cookie cũ `lumi_admin_session` (đúng, vì đang chạy dev, không phải bug).
- **Session**: TTL 14 ngày, xoá phiên hết hạn khi login, thu hồi toàn phiên khi đổi mật khẩu — đã có sẵn,
  xác nhận đúng, không sửa. Token đã rotate mỗi lần login (sinh `randomToken()` mới) — không sửa.
  `logout.ts` action chỉ nhận POST — đã đúng, không sửa.
- **Open redirect — đã tìm thấy + đã sửa 1 chỗ**: `admin/login.tsx` `next.startsWith("/admin")` — đã
  test các biến thể `//evil.com`, `/\evil.com`, `https://evil.com`, `/admin@evil.com`,
  `%2f%2fevil.com` → **tất cả đều an toàn với logic hiện tại** (không sửa `login.tsx`), vì bắt đầu bằng
  chuỗi `/admin` là điều kiện rất hẹp và mọi giá trị lọt qua vẫn là đường dẫn cùng-origin.
  Nhưng `api.cart.ts` `sanitizeRedirect()` thì **CÓ lỗ hổng thật**: chỉ chặn `value.startsWith("//")`,
  không chặn `/\evil.com` — nhiều trình duyệt (Chrome, Firefox) tự chuẩn hoá `\` thành `/` khi đọc
  header `Location`, nên `/\evil.com` biến thành `//evil.com` (protocol-relative → open redirect) SAU
  khi qua khỏi kiểm tra hiện tại. Đã thêm điều kiện chặn `value.startsWith("/\\")`.
File đã sửa: `workers/app.ts` (thêm `hasTrustedOrigin`), `app/lib/auth.server.ts` (tên cookie
`__Host-` ở prod), `app/routes/api.cart.ts` (chặn backslash trong `sanitizeRedirect`).
Kiểm chứng: `curl -X POST -H "Origin: https://evil.com" /tra-cuu-don-hang` → 403. Cùng lệnh không có
header `Origin` hoặc `Origin` đúng host → không bị 403 (qua tới logic route bình thường). GET với
`Origin: https://evil.com` → không bị chặn (200), đúng như thiết kế (chỉ áp cho non-GET/HEAD).
`POST /api/gio-hang` với `redirectTo=/\evil.com` → `Location: /gio-hang` (bị chặn về mặc định, không
còn redirect sang giá trị nguy hiểm). `next=/admin@evil.com` sau login → `Location: /admin@evil.com`
(cùng origin, không phải evil.com).

### T10 — đã tìm thấy + đã sửa
- **Đã sửa**: `cart.server.ts` `loadCartDetails` trả `unitCost` (giá nhập) trong `CartLineDetail`, và
  `shop/cart.tsx` + `shop/checkout.tsx` loader trả thẳng `items` (kèm `unitCost`) ra `data()`/return —
  rò rỉ giá nhập cho MỌI khách xem trang giỏ hàng/thanh toán (qua `.data` JSON hoặc view-source, dù UI
  không hiển thị). Đã thêm `toPublicCartItems()` trong `cart.server.ts` (bỏ field `unitCost`) và áp dụng
  ở hai loader trên; `action` của hai route này (và `order.server.ts`) vẫn dùng `loadCartDetails` đầy đủ
  vì `createOrder` cần `unitCost` để tính lợi nhuận (chỉ admin xem qua `order-detail.tsx`, đã chặn T1).
- **Đã sửa**: `getProductBySlug` (`db.server.ts`) là `SELECT p.*` nên kéo theo `cost_price` —
  `shop/product-detail.tsx` loader trả `product` thẳng ra client, rò rỉ giá nhập sản phẩm cho MỌI khách
  xem trang sản phẩm. Đã destructure bỏ `cost_price` trước khi return. `getProductById` (dùng riêng cho
  admin ở `product-new.tsx`/`product-edit.tsx`, đã có `requireAdmin` từ T1) giữ nguyên, admin được phép
  thấy giá nhập.
- `profit` ở `admin/order-detail.tsx`: chỉ admin xem, đã chặn qua T1 — không sửa thêm.
- `adminName` ở `shop/layout.tsx`: chỉ hiển thị cho ĐÚNG admin đang đăng nhập (lấy từ session của chính
  họ, không phải rò rỉ cho khách khác) — không phải lỗ hổng, không sửa.
- `root.tsx` ErrorBoundary: build production rồi soi bundle
  `build/client/assets/root-*.js` — nhánh `import.meta.env.DEV` (hiện `<pre>{stack}</pre>`) bị tree-shake
  hoàn toàn, biến `stack` không tồn tại trong code đã build → xác nhận không lộ stack trace ở prod.
- `sitemap.ts`/`robots.ts`: đã đọc lại — không liệt kê `/admin`, `/don-hang/*`; `robots.txt` disallow cả
  `/api/`, `/gio-hang`, `/thanh-toan`, `/tra-cuu-don-hang` — đúng, không sửa.
- `policy.tsx`: `params.slug` ép qua allowlist `PAGES` trước khi dùng; dữ liệu trả về chỉ là thông tin
  công khai của shop (SĐT/email liên hệ, không phải PII khách) — không sửa.
File đã sửa: `app/lib/cart.server.ts` (thêm `toPublicCartItems`), `app/routes/shop/cart.tsx`,
`app/routes/shop/checkout.tsx`, `app/routes/shop/product-detail.tsx`.
Kiểm chứng: `curl .../san-pham/<slug>.data` và `curl -b <cookie có giỏ> .../gio-hang.data` → grep
`cost_price`/`unitCost` không còn khớp gì (trước khi sửa có khớp).

### T11 — đã kiểm tra, quyết định "chưa phân quyền" (không mở rộng phạm vi)
Xác nhận đúng như plan: `role` chỉ dùng để hiển thị nhãn "Chủ shop"/"Nhân viên" ở `admin/layout.tsx`,
không có `requireOwner` hay bất kỳ kiểm tra `role` nào khác trong toàn bộ `app/`. Quan trọng hơn: **không
có đường nào trong tooling hiện tại tạo được tài khoản role='staff'** — `scripts/create-admin.mjs` hardcode
`role) VALUES (..., 'owner')` cho mọi tài khoản tạo qua script. CHECK constraint trong migration 0001 vẫn
cho phép `'staff'` ở tầng schema, nhưng không có UI/CLI nào trong repo tạo ra được.
**Quyết định**: KHÔNG thêm `requireOwner` (tránh mở rộng phạm vi khi chưa có yêu cầu nghiệp vụ multi-user
rõ ràng — plan ghi rõ "Không tự ý mở rộng phạm vi"), và KHÔNG xoá label trong UI (giữ nguyên UI/UX theo
đúng ràng buộc "Không đổi UI/UX" của Phạm Vi — nhãn hiển thị không tự nó là lỗ hổng, chỉ là chưa có tính
năng đứng sau). Nếu tương lai thực sự cần nhiều nhân viên với quyền khác nhau, cần thiết kế lại rõ ràng
danh sách trang/hành động nào staff không được vào (cai-dat, bao-cao, xuat-csv là gợi ý trong plan) rồi
làm một task riêng — không làm vội trong task audit này.
File đã sửa: không có (chỉ là quyết định, ghi lại ở đây).

### T12 — đã tìm thấy + đã sửa (SSRF/timeout) / đã kiểm tra phần còn lại
- **scheduled() vs HTTP**: xác nhận không route HTTP nào gọi `releaseExpiredOrders`/`syncScheduledPosts`
  mà bỏ qua auth — `releaseExpiredOrders` được gọi ở nhiều loader storefront NHƯNG không nhận tham số
  nào ảnh hưởng hành vi (chỉ dọn theo thời gian thật), và `syncScheduledPosts` chỉ gọi trong
  `admin/product-edit.tsx` (đã có `requireAdmin` từ T1). → không sửa.
- **Đã sửa — SSRF + timeout**: `threads.server.ts` `uploadMedia()` `fetch()` thẳng vào `upload_url` do
  Typefully TRẢ VỀ (URL S3 ký sẵn, host không biết trước) mà không kiểm tra gì — nếu response từng bị
  lừa/bug trả về URL nội bộ, Worker sẽ gọi tới hạ tầng nội bộ kèm bytes ảnh. Đã thêm `isSafeExternalUrl()`
  (chặn không phải HTTPS, chặn `localhost`/`*.local`, chặn IPv4 loopback/private/link-local
  10.x/127.x/172.16-31.x/192.168.x/169.254.x, chặn IPv6 loopback/link-local/unique-local) trước khi PUT.
  Đồng thời thêm `AbortSignal.timeout(15_000)` cho cả `call()` (mọi request tới Typefully API) và PUT ảnh
  — trước đó không có timeout nào, một request treo sẽ giữ luôn cả action đăng bài.
- **email.server.ts/telegram.server.ts — đã tìm thấy + đã sửa**: `admin/settings.tsx` lưu
  `email_from`/`email_owner`/`telegram_chat_id` do admin nhập mà KHÔNG validate định dạng gì — đã thêm
  validate: `email_owner` phải đúng khuôn email; `email_from` phải đúng khuôn email hoặc `"Tên <email>"`;
  `telegram_chat_id` phải khớp số (âm được, cho nhóm/kênh) hoặc `@username`. Rủi ro injection thực tế
  thấp (cả hai đi vào JSON body của HTTP call, không phải raw header/SMTP) nhưng validate chặn được cấu
  hình sai lặng lẽ và input rác. Lỗi trả về từ Resend/Telegram (`describeApiError`, response `description`)
  đã kiểm tra kỹ — không bao giờ echo lại `apiKey`/token, chỉ mô tả lỗi nghiệp vụ (domain chưa xác minh,
  chat not found...). → phần "không in nguyên response chứa khoá" đã đúng từ trước, không cần sửa thêm.
- `vietQrImageUrl` (`settings.server.ts`): đã kiểm tra — `accountName` đi qua `URLSearchParams`, tự
  percent-encode khi `.toString()`; `bank_id`/`bank_account_no` cũng qua `encodeURIComponent` riêng. →
  không có vấn đề, không sửa.
File đã sửa: `app/lib/threads.server.ts`, `app/routes/admin/settings.tsx`.
Kiểm chứng: POST cấu hình Telegram với `telegram_chat_id=not-a-chat-id` → 400 "Chat ID không hợp lệ".
POST cấu hình Email với `email_owner=not-an-email` → 400 "Email nhận báo đơn không hợp lệ". Không test
được SSRF thật (không có quyền trỏ Typefully trả URL nội bộ từ môi trường test) — chỉ xác nhận bằng đọc
code + `npx tsc -b` sạch; tester nên coi đây là "đã vá theo code review", không có PoC runtime.

### T13 — đã tìm thấy + đã sửa
- **Đã sửa — quyền file backup**: `scripts/backup.mjs` không giới hạn quyền file export — đã thêm
  `chmodSync(target, 0o600)` ngay sau khi export xong (trước đây file ra đời với quyền mặc định của hệ
  điều hành, thường 644 — ai khác có quyền đọc trên máy nhiều người dùng cũng đọc được).
- **Đã sửa — cảnh báo secret trong backup**: bảng `settings` chứa `typefully_api_key`, `resend_api_key`,
  `telegram_bot_token` dạng plaintext (`SECRET_KEYS` trong `settings.server.ts`) → file `.sql` export
  chứa luôn API key thật, không chỉ PII khách. Đã chọn phương án "ghi cảnh báo rõ + khuyến nghị chuyển
  sang `wrangler secret put`" (một trong 3 phương án plan cho phép) — KHÔNG loại khoá khỏi backup, vì
  `wrangler d1 export` là lệnh full-dump không có cờ lọc theo bảng/cột, tự lọc sẽ phải viết lại toàn bộ
  cơ chế export (đổi kiến trúc backup, ngoài phạm vi "thay đổi tối thiểu" của task này). Đã in thêm đoạn
  cảnh báo chi tiết ở cuối script (sau khi export xong) giải thích rõ vì sao và cách khắc phục triệt để.
- **Đã sửa — dọn thư mục tạm**: `scripts/create-admin.mjs` tạo `.sql` tạm chứa hash mật khẩu (đã có
  `mode: 0o600` từ trước — giữ nguyên) nhưng KHÔNG xoá thư mục tạm sau khi chạy — đã thêm
  `rmSync(dir, {recursive:true, force:true})` trong `finally`, và chuyển `process.exit(1)` ra ngoài
  try/catch/finally (đặt trong catch sẽ tắt tiến trình trước khi `finally` kịp chạy, khiến file tạm
  không được xoá khi wrangler lỗi — chính là ca hay xảy ra nhất, ví dụ gõ sai `--remote` mà chưa login).
- `scripts/seed-orders.mjs`, `scripts/seed-images.mjs`, `scripts/screenshots.mjs`: đã đọc kỹ — không
  chứa dữ liệu/khoá thật (toàn tên khách giả, ảnh SVG code sinh); không có script nào default `--remote`
  (`seed-images.mjs` có cờ `--remote` tuỳ chọn nhưng default là `--local`; hai script còn lại chỉ gọi
  HTTP vào `http://localhost:5173`, không đụng D1/R2 trực tiếp). → không sửa.
File đã sửa: `scripts/backup.mjs`, `scripts/create-admin.mjs`.
Kiểm chứng: `node scripts/backup.mjs --local` → file mới tạo có quyền `-rw-------` (xác nhận bằng
`ls -la backups/`), in đủ đoạn cảnh báo secret. `ADMIN_PASSWORD='Lumi@2026' node scripts/create-admin.mjs
thuy "Chi Thuy"` → `find /tmp /var/folders -iname "lumi-admin-*"` sau khi chạy trả rỗng (thư mục tạm đã
bị xoá).

### T14 — đã tìm thấy + đã sửa (dependency) / đã kiểm tra phần còn lại
- **`npm audit --omit=dev` ban đầu**: 1 lỗ hổng HIGH ở `react-router` (nhiều CVE: open redirect biến thể
  backslash, XSS qua redirect, CSRF trong Action/Server Action, DoS qua route matching/`__manifest`,
  stored XSS qua Location header khi prerender...). Bản vá `7.18.4` vẫn trong dòng major 7 (KHÔNG phải
  nâng major, đúng giới hạn plan cho phép "chỉ nâng minor/patch") — đã nâng `react-router` VÀ
  `@react-router/dev` từ `7.9.6` lên `7.18.4` (khoá exact version như cũ). `npm audit --omit=dev` sau đó
  → 0 lỗ hổng.
- **`npm audit` đầy đủ (kể cả devDependencies) sau khi vá react-router**: còn 4 → 3 lỗ hổng HIGH ở
  `sharp` (qua `libheif`, dùng trong `miniflare`/`wrangler` cho dev server xử lý ảnh preview — KHÔNG nằm
  trong runtime production, chỉ ảnh hưởng lúc chạy `wrangler dev`/Vite dev cục bộ). Đã nâng
  `@cloudflare/vite-plugin` từ `1.52.1` lên `1.62.0` (mới nhất dòng major 1.x, bản 2.x còn beta) — giảm
  còn 3 lỗ hổng (nested wrangler copy trong vite-plugin đã tự vá theo). 3 lỗ hổng còn lại đều quy về
  `wrangler@4.127.0` (devDependency top-level, pin cứng trong `package.json`) nằm trong khoảng bị ảnh
  hưởng — bản vá cần `wrangler@4.143.0`. **Quyết định: KHÔNG nâng**, vì plan ghi rõ "Không nâng major
  (React 19 / React Router 7.9.6 / **Wrangler**) trong task này" — dù 4.127→4.143 chỉ là minor, plan liệt
  kê Wrangler như một ngoại lệ riêng cần giữ nguyên trong lần audit này (rủi ro ảnh hưởng `npm run
  check`/pipeline deploy). **Rủi ro còn lại được chấp nhận**: `sharp`/`libheif` là devDependency-only, chỉ
  chạy trong `wrangler dev`/Vite dev cục bộ khi xử lý ảnh xem trước — không nằm trong Worker đã deploy,
  không ảnh hưởng khách truy cập site thật. Khuyến nghị: nâng `wrangler` lên ≥4.143.0 ở một task riêng
  sau khi audit này đóng, kèm chạy lại toàn bộ `npm run check` + smoke test deploy.
- Sau khi nâng `react-router`/`@react-router/dev`, cờ cấu hình đổi tên: `future.unstable_viteEnvironmentApi`
  → `future.v8_viteEnvironmentApi` (bắt buộc, nếu không `npm run check` lỗi ngay ở bước typegen) — đã sửa
  `react-router.config.ts`. Đây là thay đổi tối thiểu bắt buộc để bản vá hoạt động, không phải thay đổi
  tính năng.
- `wrangler.json`: đã đọc lại toàn bộ — `compatibility_date`, `nodejs_compat`, `observability.enabled`,
  `upload_source_maps`, binding `DB`/`IMAGES`, cron `*/15 * * * *` đều hợp lý, không có route/domain nào
  mở thêm, `vars` chỉ 2 giá trị công khai (đã xác nhận lại ở T5) → không sửa.
- `vite.config.ts`/`react-router.config.ts` (ngoài đổi flag trên)/`tsconfig*.json`: không có `define`
  nào bơm biến server vào client; không cấu hình sourcemap client — xác nhận bằng
  `find build/client -iname "*.map"` sau `npm run build` → 0 kết quả (source map KHÔNG lên bundle client
  công khai; `upload_source_maps: true` trong `wrangler.json` chỉ upload source map SERVER lên dashboard
  Cloudflare riêng tư cho debug, không phải public). → không sửa.
- **`npm run check` (typegen + tsc -b + react-router build + wrangler deploy --dry-run): PASS** sau toàn
  bộ 14 task, chạy lần cuối cùng sau khi nâng dependency.
File đã sửa: `package.json`, `package-lock.json`, `react-router.config.ts`.

### Việc phát sinh ngoài phạm vi (không tự làm, ghi lại cho người dùng quyết định)
- Nâng `wrangler` (devDependency, hiện `4.127.0`) lên `≥4.143.0` để dứt điểm nốt lỗ hổng `sharp`/`libheif`
  còn lại trong `npm audit` — plan yêu cầu giữ nguyên Wrangler trong task này nên chưa làm.
- CSP hiện là Report-Only (chưa enforce) vì React Router chèn script hydrate inline không nonce và trang
  admin dùng style inline cho biểu đồ — muốn enforce cứng cần: (a) đợi React Router hỗ trợ nonce cho
  script hydrate, hoặc tự viết entry.server tuỳ biến để gắn nonce; (b) chuyển các `style={{width}}` inline
  ở `dashboard.tsx`/`reports.tsx` sang class Tailwind động (ví dụ CSS variable) để bỏ được `'unsafe-inline'`
  khỏi `style-src`. Cả hai đều đổi cách trang admin dựng UI — ngoài phạm vi "không đổi UI/UX" của task.
- T11: nếu tương lai thực sự cần tài khoản "Nhân viên" giới hạn quyền, cần một task riêng thiết kế rõ
  danh sách trang/hành động owner-only và cách tạo tài khoản staff (hiện chưa có).
- Không xác minh được từ trong repo: Cloudflare WAF/Rate Limiting rules ở tầng mạng, quyền truy cập R2
  bucket ở dashboard, `COOKIE_SECRET`/các secret khác đã thật sự được `wrangler secret put` ở production
  hay chưa (chỉ có ở `.dev.vars` local do dev tạo để tự test) — cần chủ shop tự cấu hình trước khi deploy.

## Test report vòng 2 (tester điền)

**Ghi chú mở đầu**: một lượt tester trước đó bị stall giữa lúc test checkout, không để lại báo cáo. Phát
hiện một tiến trình `npm run dev` cũ còn sống (PID 93284, đang LISTEN cổng `9229`/`5173`) — đã `kill -9`
trước khi bắt đầu, xác nhận cổng 5173 trống, rồi khởi động `npm run dev` sạch từ đầu (không tái sử dụng
state của lượt trước, dù D1/R2 local vẫn giữ nguyên dữ liệu đã seed sẵn — không seed lại vì
`npm run db:seed` báo lỗi `FOREIGN KEY constraint failed` do DB không rỗng, kiểm tra `SELECT COUNT(*)` thấy
đã có 20 sản phẩm / 10 đơn từ trước, coi như môi trường hợp lệ, không cần seed lại). Admin `thuy` / `Lumi@2026`
đã tồn tại sẵn (không cần tạo lại). `.dev.vars` có `COOKIE_SECRET` hợp lệ 44 ký tự.

Mỗi điểm test độc lập theo yêu cầu — nếu một điểm lỗi/treo thì ghi FAIL/BLOCKED và tiếp tục điểm sau (không
điểm nào bị treo trong lượt này).

### 1. Finding #1 (CRITICAL) — rò rỉ unit_cost/admin_note ở `/don-hang/<code>.data` — **PASS**
- Thêm 1 biến thể vào giỏ (`POST /api/gio-hang intent=add variantId=63`) → 302, cookie `lumi_cart` set.
- Đặt đơn thật qua `POST /thanh-toan` (customerName/Phone/Address hợp lệ, paymentMethod=cod) → 302 tới
  `/don-hang/LUMI01450`, `Set-Cookie: lumi_orders=<base64>.<hmac>` (cookie ký hợp lệ).
- `curl -b <cookie> http://localhost:5173/don-hang/LUMI01450.data` → HTTP 200,
  `grep -oE "unit_cost|admin_note"` trên toàn bộ response → **không khớp gì** (rỗng).
- Đối chiếu phía admin: login `thuy`/`Lumi@2026` → 302 `/admin`. `GET /admin/don-hang/18.data` (id nội bộ
  của đơn LUMI01450) → HTTP 200, `grep -oE "unit_cost|admin_note|profit"` → khớp cả 3 (`profit`,
  `admin_note`, `unit_cost` đều còn nguyên phía admin). **Không hồi quy phía admin.**

### 2. Finding #2 — rate limit theo username/mã đơn — **PASS**
- Brute force 10 lần `POST /admin/dang-nhap` với `username=bruteforcetest` (mật khẩu sai đổi mỗi lần).
- Brute force 12 lần `POST /tra-cuu-don-hang` với `code=LUMI99999` (không tồn tại), IP giống nhau.
- Đọc bảng `rate_limits` (`npx wrangler d1 execute lumi-shop-db --local --command "SELECT scope,
  identifier, count FROM rate_limits ORDER BY id DESC LIMIT 20"`) → có dòng
  `scope=order-lookup-code, identifier=LUMI99999, count=12` và `scope=admin-login-user,
  identifier=bruteforcetest, count=10`, song song với `order-lookup`/`admin-login` theo IP — đúng như Dev
  notes mô tả (2 chiều khoá).
- Test bổ sung theo gợi ý của Dev notes: brute force 8 lần `username=thuy` (mật khẩu sai) nhưng **mỗi lần
  đổi header `CF-Connecting-IP` giả sang một IP khác** → vẫn bị chặn (429 từ lần thứ 6), rồi thử đăng nhập
  **đúng mật khẩu** `Lumi@2026` từ một IP giả thứ 3 → vẫn 429. Xác nhận `rate_limits` có
  `scope=admin-login-user, identifier=thuy, count=12` → chứng minh khoá theo username chặn được kể cả khi
  đổi IP liên tục (đúng mục tiêu Warning #2).

### 3. Finding #3 — `checkRateLimitSoft` fail-open ở checkout/cart — **PASS**
- Đọc code `app/lib/rate-limit.server.ts`: `checkRateLimitSoft()` bọc `checkRateLimit()` gốc trong
  try/catch, lỗi thì `console.error` và trả `{allowed: true, retryAfterSeconds: 0}` (fail-open). Xác nhận
  `app/routes/shop/checkout.tsx:100` và `app/routes/api.cart.ts:24` dùng đúng bản `Soft`; `admin/login.tsx`
  và `order-lookup.tsx` vẫn dùng `checkRateLimit` gốc (fail-closed) — khớp mô tả Dev notes.
- Test runtime (không mô phỏng lỗi D1 thật — không có cách dễ trong môi trường test, như Dev notes lường
  trước): thêm/sửa/xoá giỏ hàng 4 lần liên tiếp (`add`, `update`, `add` biến thể khác, `remove`) → toàn bộ
  302, không có 500. Đặt 1 đơn thật qua `/thanh-toan` → 302 thành công (`LUMI43487`), không 500.

### 4. Finding #4 — COOKIE_SECRET yếu bị từ chối (fail-closed) — **PASS**
- Sửa tạm `.dev.vars` thành `COOKIE_SECRET=short-secret-123` (16 ký tự, dưới ngưỡng 32), kill dev server cũ
  (PID 99426 lượt đầu, PID 282 lượt giữa) và `npm run dev` lại sạch mỗi lần đổi secret.
- `POST /tra-cuu-don-hang` với mã/SĐT đúng → **HTTP 503**, nội dung
  `"Hệ thống đang bảo trì, vui lòng thử lại sau ít phút."` — fail-closed đúng cách, không crash khó hiểu.
- `GET /don-hang/<code>` với cookie đã ký hợp lệ từ TRƯỚC (secret cũ) → 302 (bị coi như không có quyền,
  không xem được, không lỗi 500).
- Trang chủ `GET /` vẫn 200 (secret yếu không làm sập toàn site, chỉ ảnh hưởng đúng phạm vi đơn hàng).
- Checkout vẫn hoạt động: `POST /thanh-toan` với secret yếu → vẫn tạo đơn thành công (302 tới
  `/don-hang/LUMI35679`) nhưng **không** có `Set-Cookie: lumi_orders` trong response (đúng như Dev notes —
  chỉ bỏ qua bước ghi nhớ, không chặn luồng mua hàng).
- Đã trả `.dev.vars` về `COOKIE_SECRET=fL61hEiTVtUuANx1KNScmO89o97wZGrUebsjvXXmQvo=` (44 ký tự, giá trị gốc
  do dev để lại), restart dev server sạch lại, xác nhận `POST /tra-cuu-don-hang` với mã/SĐT đúng trả về 302
  bình thường (không còn 503) trước khi tiếp tục các mục sau.

### 5. Finding #5 — SVG chỉ phục vụ ở `demo/` — **PASS**
- `GET /anh/demo/p1-a.svg` (SVG thật từ seed) → 200, `Content-Type: image/svg+xml`.
- `GET /anh/fake.svg`, `/anh/products/fake.svg`, `/anh/../../etc/passwd`, `/anh/settings/`,
  `/anh/secrets/backup.sql` → tất cả 404 (không lộ cấu trúc bucket).
- Test mạnh hơn plan yêu cầu: tự tạo object SVG thật (chứa `<script>alert(1)</script>`) tại
  `products/evil-test.svg` bằng `wrangler r2 object put ... --local --content-type "image/svg+xml"`, sau đó
  `GET /anh/products/evil-test.svg` → **404 kèm `Content-Disposition: attachment`** dù object có tồn tại
  thật trong bucket và đúng định dạng SVG — xác nhận `isSafeImageType()` chặn đúng theo prefix `demo/`, không
  chỉ dựa vào key có tồn tại hay không. Đã xoá object test (`wrangler r2 object delete ... --local`) sau khi
  xong.

### 6, 7. Finding #6 (SSRF allowlist host + redirect manual) và #7 (dọn rate_limits theo xác suất) — đọc code, khớp mô tả
- `app/lib/threads.server.ts`: `isSafeExternalUrl()` có blocklist IP/localhost cũ + allowlist mới
  `host.endsWith(".amazonaws.com") || host.endsWith(".typefully.com")`; `uploadMedia()` gọi PUT ảnh với
  `redirect: "manual"` và coi `opaqueredirect`/3xx là lỗi; `AbortSignal.timeout(15_000)` áp cho cả `call()`
  và PUT. Không đổi header của PUT (giữ nguyên fix của commit `cc8cb16`). **Khớp đúng mô tả Dev notes**,
  không có sai khác. Không test được PoC SSRF/Threads thật (không có tài khoản Typefully trong môi trường
  test) — đúng như Dev notes đã lường trước, chỉ xác nhận qua đọc code.
- `app/lib/rate-limit.server.ts`: câu `DELETE` dọn cửa sổ cũ nằm trong `if (Math.random() < 0.01)`, không
  còn chạy ở mọi lần gọi. **Khớp đúng mô tả Dev notes.**

### 8. `npm run check` — **PASS**
`npm run check` (typegen + `tsc -b` + `react-router build` + `wrangler deploy --dry-run`) chạy xong, exit
code `0`. Build client + server thành công, `wrangler deploy --dry-run` liệt kê đủ binding `DB`/`IMAGES` và
2 biến môi trường công khai, kết thúc bằng `--dry-run: exiting now.` không có lỗi.

### Hồi quy nhanh (mục 7 trong yêu cầu giao việc) — **PASS**
- **Lượt mua hàng đầy đủ**: giỏ hàng (`add`/`update`/`add`/`remove`, đều 302, không 500) → đặt hàng thành
  công (`LUMI43487`, 302) → xem đơn `GET /don-hang/LUMI43487` (302, đúng quyền) → tra cứu đơn bằng đúng
  mã + SĐT từ IP khác (`POST /tra-cuu-don-hang`, 302, set cookie ký hợp lệ).
- **Lượt admin**: login `thuy`/`Lumi@2026` (302) → xem danh sách đơn (`/admin/don-hang`, 200) → xem chi
  tiết đơn (`/admin/don-hang/18`, 200) → sửa nhẹ sản phẩm 1 (thêm hậu tố `[tester v2]` vào mô tả qua
  `POST /admin/san-pham/1` multipart đầy đủ field/variant) → 200 kèm thông báo "Đã lưu thay đổi.", xác nhận
  `SELECT description FROM products WHERE id=1` đã đổi → **sau đó revert lại y hệt bản gốc** (đã xác nhận
  bằng `SELECT description ...` khớp lại chuỗi ban đầu, không để lại thay đổi rác trong DB test).

### Tổng kết
- **9 điểm 1–8 (+ hồi quy)**: tất cả **PASS**, không có FAIL/BLOCKED nào trong lượt test lại này.
- **`npm run check`: PASS** (exit code 0).
- Không phát hiện lỗ hổng mới nào trong 5 finding đã yêu cầu sửa (#1–#5) và 2 khuyến nghị đã đọc code
  (#6, #7). Không có hồi quy nào ở luồng mua hàng/luồng admin.
- Dev server đã tắt hoàn toàn sau khi test xong (xác nhận `lsof -nP -iTCP -sTCP:LISTEN | grep node` không
  còn tiến trình nào lắng nghe cổng 5173/9229).
- **Verdict tổng thể vòng 2: PASS.** Đề nghị chuyển cho reviewer duyệt lại vòng 2.

---

## Test report (tester điền)

**Chuẩn bị**: `.dev.vars` đã có sẵn `COOKIE_SECRET` (do dev tạo trước). `npm run db:migrate` → "No migrations
to apply" (đã áp từ trước). `npm run db:seed` + `npm run db:seed-orders` chạy OK. Tạo admin
`ADMIN_PASSWORD='Tester@123456' node scripts/create-admin.mjs test "Tester"` → OK. `npm run dev` chạy
background, server lên tại `http://localhost:5173`. Chú ý: DB local đã có dữ liệu từ trước (id sản phẩm/đơn
không bắt đầu từ 1) — đã dùng id thực tế đọc từ D1 thay vì id=1 cứng trong vài lệnh `curl`, không ảnh hưởng
kết quả.

### A. Authz admin (T1) — PASS
- GET không cookie 12 route (`/admin`, `/admin/don-hang`, `/admin/don-hang/8`, `/admin/don-hang/8/phieu`,
  `/admin/don-hang/xuat-csv`, `/admin/khuyen-mai`, `/admin/danh-gia`, `/admin/bao-cao`, `/admin/cai-dat`,
  `/admin/san-pham`, `/admin/san-pham/moi`, `/admin/san-pham/1`) → **cả 12 đều 302** tới
  `/admin/dang-nhap?next=...`, `content-length: 0` (không có dữ liệu trong body).
- POST không cookie:
  - `/admin/san-pham` `intent=discontinue&productId=1` → 302 redirect; `SELECT status FROM products
    WHERE id=1` vẫn `active`.
  - `/admin/don-hang/8` `intent=mark-paid` → 302; `payment_status` vẫn `pending`.
  - `/admin/don-hang/8` `intent=note&adminNote=hacked` → 302; `admin_note` vẫn `NULL`.
  - `/admin/khuyen-mai` tạo `HACK10` → 302; `SELECT COUNT(*) FROM discount_codes WHERE code='HACK10'` = 0.
  - `/admin/danh-gia` `intent=toggle&reviewId=8` → 302; `is_visible` không đổi (vẫn 1).
  - `/admin/san-pham/1` `intent=post-threads` → 302; `SELECT COUNT(*) FROM social_posts` vẫn 0.
- Single fetch `.data`: `/admin/don-hang/8.data`, `/admin/don-hang/8.data?_routes=routes/admin/order-detail`,
  `/admin.data?_routes=routes/admin/dashboard` → cả 3 trả `SingleFetchRedirect` tới
  `/admin/dang-nhap?next=...`, **không có payload dữ liệu đơn/thống kê nào** trong response.
- Hồi quy sau đăng nhập: `POST /admin/dang-nhap` đúng mật khẩu → 302 `/admin` + `Set-Cookie`
  `lumi_admin_session`. Sau đó GET lại toàn bộ 11 route trên (kèm `/admin/san-pham/1`,
  `/admin/don-hang/xuat-csv`) đều trả **200** — không hồi quy.
- Kết luận: đúng tiêu chí nghiệm thu #1.

### B. IDOR đơn hàng (T2) — PASS
- Đặt đơn thật qua flow `api/gio-hang` (add) → `thanh-toan` (order) → nhận mã `LUMI80765`,
  `Set-Cookie: lumi_orders=<base64>.<hmac>`.
- GET `/don-hang/LUMI80765` không cookie → 302 `/tra-cuu-don-hang?ma=LUMI80765` (không xem được).
- GET với cookie hợp lệ vừa nhận → 200, xem đúng đơn.
- Giả cookie định dạng cũ (base64 JSON, không hmac) chứa đúng mã `LUMI80765` → 302 về tra cứu, **không**
  xem được đơn (IDOR đã chặn).
- Cookie có payload đúng nhưng hmac giả (68 ký tự `A`) → 302 về tra cứu, không xem được.
- Cookie giả cho mã đơn ngẫu nhiên `LUMI99999` → 302 về tra cứu (không leak việc mã có tồn tại hay không).
- Tra cứu đúng mã + đúng SĐT (`LUMI80765` / `0912345678`) → 302 tới `/don-hang/LUMI80765` kèm cookie ký hợp
  lệ. Tra cứu đúng mã + SĐT sai → **404** với thông báo chung "Không tìm thấy đơn hàng khớp với mã và số
  điện thoại này" (không lộ đơn có tồn tại hay không).
- Giỏ hàng vẫn hoạt động khi cookie `lumi_cart`/`lumi_discount` là rác (`garbage`) — GET `/gio-hang` vẫn
  200, thêm hàng mới (`POST /api/gio-hang intent=add`) vẫn 302 + set cookie hợp lệ, không 500.
- Kết luận: đúng tiêu chí nghiệm thu #2.

### C. Rate limit (T3) — PASS (có 1 lưu ý nhỏ, không tính FAIL)
- Brute force `/admin/dang-nhap` sai mật khẩu 12 lần liên tiếp → 401 các lần đầu, chuyển sang **429** từ
  lần thứ 8 (đúng ngưỡng 8/5 phút ghi trong Dev notes, cộng dồn với vài lần login hợp lệ trước đó trong
  cùng session test). Body 429 chứa thông báo tiếng Việt "Bạn thao tác quá nhanh, vui lòng thử lại sau
  khoảng 2 phút."
- Brute force `/tra-cuu-don-hang` sai mã/SĐT 12 lần liên tiếp → 404 (không khớp) 8 lần đầu, **429** từ lần
  thứ 9 (đúng ngưỡng 10/5 phút, cộng dồn số lần đã tra cứu trước trong test B).
- Brute force `POST /api/gio-hang` (cart-write) 66 lần trong hơn 1 phút → 429 ở lần thứ 66, kèm header
  `retry-after: 43` và body text "Thao tác quá nhanh, vui lòng thử lại sau ít phút." — **route này set
  header `Retry-After` đúng như mô tả**.
- Sau khi `DELETE FROM rate_limits` (dọn bộ đếm test, chỉ là dữ liệu, không sửa code) để mô phỏng cửa sổ
  đã trôi qua → đăng nhập đúng mật khẩu ngay lập tức thành công (302 `/admin`) — xác nhận rate limit không
  chặn người dùng hợp lệ ngoài cửa sổ chặn.
- **Lưu ý (không tính FAIL, nhưng nên sửa)**: response 429 của `/admin/dang-nhap`, `/tra-cuu-don-hang` (và
  suy luận tương tự cho `/thanh-toan`) render qua `data(..., {headers: {"Retry-After": ...}})` trong action
  của route document (không phải resource route như `api.cart.ts`) — header `Retry-After` **KHÔNG** xuất
  hiện trong response HTTP thật (`curl -D -` không thấy header này ở cả `/admin/dang-nhap` và
  `/tra-cuu-don-hang` khi bị 429), dù status 429 và message tiếng Việt trong HTML body đều đúng. So với
  Dev notes T3 ghi "429 kèm `Retry-After`" thì có sai khác nhỏ ở 2 route dùng UI form (không ảnh hưởng tới
  tiêu chí nghiệm thu #3 vì tiêu chí chỉ yêu cầu 429 + thông báo tiếng Việt, cả hai đã có) — đề nghị dev
  kiểm tra lại cách `data()`/`headers()` export hoạt động với action của route render HTML để header
  không bị rơi mất (có thể cần thêm `export function headers()` cho các route đó, giống cách Set-Cookie
  vẫn qua được).

### D. Headers (T4) — PASS
- `curl -I /` và `curl -I /admin/dang-nhap`: đều có `x-content-type-options: nosniff`,
  `referrer-policy: strict-origin-when-cross-origin`, `x-frame-options: DENY`,
  `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()`, và
  `content-security-policy-report-only: ...` (đúng như Dev notes, chưa enforce). Không có HSTS vì đang
  chạy dev qua http (đúng như dự kiến).
- `curl -I /anh/demo/p1-a.svg` → có `x-content-type-options: nosniff`, `cache-control: public,
  max-age=31536000, immutable`, `etag`, và CSP report-only giống trên.
- Kiểm tra browser thật bằng Playwright (Chromium headless, đã cài sẵn trong repo): mở `/`,
  `/san-pham/ao-so-mi-lua-tay-dai`, `/admin/dang-nhap`, và `/admin` (có cookie phiên hợp lệ) — **không có
  console error/warning nào, không có `pageerror`** ở cả 4 trang → CSP Report-Only không chặn hydration,
  không có lỗi CSP nào bị log.

### E. Upload & ảnh (T6) — PASS (1 phát hiện phụ, xem mục "Bug tìm thấy")
- Tạo sản phẩm với ảnh thật header magic bytes JPEG (`FF D8 FF E0` + random bytes, KHÔNG phải ảnh hợp lệ
  về nội dung nhưng đúng signature) → **được nhận** (302, tạo sản phẩm id 17 thành công) — đúng vì hàm chỉ
  dò 16 byte đầu.
- Tạo sản phẩm với file `.txt` đổi tên `.jpg`, `Content-Type: image/jpeg` giả → **bị từ chối**, 400, lỗi
  "Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc AVIF".
- Tạo sản phẩm với file > 5MB (có magic bytes JPEG hợp lệ) → **bị từ chối**, 400, lỗi
  `Ảnh "oversized.jpg" vượt quá 5MB`.
- `GET /anh/../../etc/passwd` (cả normalize thường và `--path-as-is` giữ nguyên `..` trong path) → 404.
- `GET /anh/settings/` (thư mục, không key) → 404. `GET /anh/products/doesnotexist123.jpg` (key hợp lệ
  prefix nhưng không tồn tại) → 404. `GET /anh/backup.sql` (prefix không hợp lệ) → 404. Không route nào
  lộ cấu trúc bucket qua body/header khác biệt.
- Kết luận: đúng tiêu chí nghiệm thu #6.

### F. CSV & XSS (T8) — PASS
- Đặt đơn thật với `customerName="=cmd|' /C calc'!A0"` và `note="+1+2"` → xuất CSV admin
  (`/admin/don-hang/xuat-csv`), 2 ô tương ứng ra `"'=cmd|' /C calc'!A0"` và `"'+1+2"` — đã vô hiệu hoá công
  thức bằng tiền tố `'`. (Ghi chú thêm: ô SĐT cũng có tiền tố `'` — đây là hành vi **có chủ đích** để Excel
  không cắt số 0 đầu, không phải lỗi.)
- Tạo sản phẩm tên `<img src=x onerror=alert(1)>` → lưu nguyên văn trong DB, nhưng hiển thị **dạng text đã
  escape** (`&lt;img src=x onerror=alert(1)&gt;`) ở cả trang chi tiết sản phẩm storefront và trang sửa sản
  phẩm admin (kể cả trong thuộc tính `value` của input) — không thực thi được.
- Tạo sản phẩm tên có `&` và `'` (`Ao & Vay set do'`) → `/sitemap.xml` vẫn well-formed (parse XML thành
  công bằng `xml.etree.ElementTree`, 37 `<url>` entries, slug tự động chuẩn hoá về
  `ao-vay-set-do` không chứa ký tự đặc biệt).
- Kết luận: đúng tiêu chí nghiệm thu #7.

### G. Redirect & CSRF (T9) — PASS
- `/admin/dang-nhap?next=//evil.com`, `?next=/\evil.com`, `?next=https://evil.com`,
  `?next=/admin@evil.com`, `?next=%2f%2fevil.com` → GET trang login đều 200 (hiện `next` trong hidden
  input, chưa redirect gì cả — bình thường). POST đăng nhập đúng mật khẩu với từng giá trị `next` trên →
  **tất cả Location sau login đều same-origin**: 4/5 giá trị redirect về `/admin` (bị từ chối, dùng
  fallback), riêng `/admin@evil.com` redirect đúng y giá trị `/admin@evil.com` (vẫn là path cùng-origin,
  không phải host `evil.com`, đúng phân tích trong Dev notes).
- `GET /admin/dang-xuat` (có cookie phiên) → 302 `/admin`, **không đăng xuất** (verify: request `/admin`
  ngay sau đó vẫn 200, cookie phiên còn hiệu lực). `POST /admin/dang-xuat` → 302 `/admin/dang-nhap` +
  `Set-Cookie: lumi_admin_session=; Max-Age=0` (đăng xuất thật).
- `POST /tra-cuu-don-hang` với header `Origin: https://evil.com` → **403 Forbidden**. Cùng request KHÔNG
  có header `Origin` → 302 (qua bình thường, không bị chặn). Cùng request với `Origin: http://localhost:5173`
  (đúng host) → 302 (qua bình thường, có thêm header `Access-Control-Allow-Origin`). `GET /` với
  `Origin: https://evil.com` → 200 (không bị chặn, đúng vì chỉ áp cho non-GET/HEAD).
- Kết luận: đúng tiêu chí nghiệm thu #9 phần CSRF/redirect.

### H. Hồi quy nghiệp vụ — PASS
- **Luồng khách mua hàng đầy đủ** (dùng cookie jar riêng, mô phỏng khách ẩn danh thật):
  thêm giỏ (`POST /api/gio-hang intent=add`, 302 + `Set-Cookie lumi_cart`) → áp mã giảm giá `CHAOBAN`
  (`POST /thanh-toan intent=discount`, 302 + `Set-Cookie lumi_discount`) → trang `/thanh-toan` (GET) hiện
  đúng mã `CHAOBAN` và dòng "Giảm giá" → đặt hàng (`POST /thanh-toan intent=order`, 302 tới
  `/don-hang/LUMI05644` + cookie giỏ được xoá + `lumi_orders` mới) → xem đơn bằng cookie vừa nhận (200) →
  tra cứu lại bằng đúng mã+SĐT (`POST /tra-cuu-don-hang`, 302 tới đúng đơn) → sau khi admin chuyển đơn này
  qua `confirmed → shipping → delivered`, khách gửi đánh giá (`POST /don-hang/LUMI05644 intent=review`,
  200, "Cảm ơn bạn đã đánh giá!") → xác nhận trong DB `product_reviews` có dòng mới `rating=5`,
  `is_visible=1`.
- **Luồng admin**: đăng nhập đúng mật khẩu (302 `/admin`) → tạo sản phẩm mới kèm ảnh hợp lệ (magic bytes
  JPEG) thành công (302, sản phẩm id 17) → đổi trạng thái đơn hàng theo đúng thứ tự flow
  (`pending→confirmed→shipping→delivered`, mỗi bước 200, DB cập nhật đúng) → tạo mã giảm giá mới
  `TESTOK10` thành công (302, có dòng mới trong `discount_codes`) → ẩn 1 đánh giá (`intent=toggle`, 302,
  `is_visible` 1→0) → xuất CSV đơn hàng thành công (200, file có nội dung đúng, xem mục F) → đổi cài đặt
  `shop_tagline` (200, DB cập nhật ngay, đã trả lại giá trị gốc sau khi xác nhận).
- **`npm run check`**: **PASS** — `typegen` (wrangler types + react-router typegen) OK, `tsc -b` không có
  lỗi, `react-router build` (client + server) thành công, `wrangler deploy --dry-run` thành công (in đủ
  bindings `DB`, `IMAGES`, `SHOP_NAME`, `SHOP_TAGLINE`, tổng dung lượng upload 1272.65 KiB / gzip 250 KiB).
- `npm audit --omit=dev` chạy lại: **0 vulnerabilities**, khớp Dev notes T14.
- Kết luận: đúng tiêu chí nghiệm thu #9 phần nghiệm vụ và #10.

### Bug/phát hiện tìm thấy (mô tả để dev xem lại, không tự sửa)

1. **[Minor] `Retry-After` header bị rơi mất ở route render HTML khi 429** — xem chi tiết ở mục C. Route:
   `app/routes/admin/login.tsx` (action), `app/routes/shop/order-lookup.tsx` (action), và có khả năng
   `app/routes/shop/checkout.tsx` (action) cùng pattern `return data({...}, {status: 429, headers:
   {"Retry-After": ...}})`. Tái hiện: brute force sai 8+ lần vào `/admin/dang-nhap` hoặc 9+ lần vào
   `/tra-cuu-don-hang`, sau đó `curl -D - -o /dev/null -X POST ...` xem header response — không thấy
   `retry-after`. Kỳ vọng: có header `Retry-After: <giây>` giống `app/routes/api.cart.ts` (route đó set
   đúng, có `retry-after: 43` khi test). Không tính FAIL vì tiêu chí nghiệm thu #3 chỉ yêu cầu 429 + thông
   báo tiếng Việt (cả hai đã đúng), nhưng nên sửa để đồng nhất hành vi giữa các route rate-limit.

2. **[Data integrity, không phải lỗ hổng bảo mật, có trước T6 nhưng đáng chú ý]** — khi admin submit form
   "Thêm sản phẩm" với ảnh không hợp lệ (bị `sniffImageType` từ chối, hoặc vượt 5MB, hoặc vượt
   `MAX_IMAGES_PER_SUBMIT`), `saveProduct()` trong `app/lib/product-form.server.ts` đã **INSERT sản phẩm +
   variants vào DB trước khi validate ảnh** (`saveImages()` gọi sau, ở dòng ~262). Kết quả: request trả về
   400 với lỗi "Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc AVIF" và re-render lại FORM RỖNG (như thể chưa lưu gì),
   nhưng thực tế **sản phẩm đã được tạo "mồ côi"** trong DB (không ảnh, nhưng có đủ tên/giá/variant/tồn
   kho, hiển thị luôn trên storefront nếu status=active). Tái hiện: đăng nhập admin, POST
   `/admin/san-pham/moi` multipart với 1 ảnh có `Content-Type: image/jpeg` nhưng nội dung không phải ảnh
   thật (ví dụ file text đổi tên `.jpg`) + các field sản phẩm hợp lệ khác → response 400 (đúng, ảnh bị
   chặn) nhưng `SELECT * FROM products WHERE name='<tên vừa gửi>'` vẫn trả về 1 dòng mới. Nếu admin thấy
   lỗi và bấm lưu lại lần 2 (sau khi đổi ảnh) sẽ tạo THÊM một sản phẩm trùng tên, để lại sản phẩm rác lần
   đầu. Không phải yêu cầu bắt buộc của task T6 (task chỉ yêu cầu chặn ảnh giả, đã làm đúng), nhưng nên cân
   nhắc đảo thứ tự (validate + upload ảnh trước, insert sản phẩm sau) hoặc bọc trong transaction/rollback ở
   một task khác. Ghi lại để chủ shop/dev biết, không tính FAIL cho T6.

### Tổng kết
- **Tổng số ca kiểm tra theo mục A–H**: 8/8 mục PASS (không có FAIL nào phải yêu cầu dev sửa lại trong
  vòng này).
- **2 phát hiện phụ** (không phải yêu cầu của task, không vi phạm tiêu chí nghiệm thu): xem "Bug/phát hiện
  tìm thấy" — đề xuất dev xem xét trong một lần sửa nhỏ tiếp theo nếu muốn, không bắt buộc chặn release.
- **`npm run check`: PASS.** **`npm audit --omit=dev`: 0 vulnerabilities.**
- **Verdict tổng thể: PASS toàn bộ 14 task theo kế hoạch test.** Không có lỗ hổng bảo mật nào còn mở theo
  10 tiêu chí nghiệm thu đã liệt kê trong PLAN.md.

### Sửa theo Review vòng 1 (CHANGES REQUESTED)

**Đã sửa Critical #1**: thêm `toPublicOrder()` trong `app/lib/order.server.ts` (cùng pattern với
`toPublicCartItems()` đã có trong `cart.server.ts` ở T10) — bỏ `admin_note` khỏi đơn và `unit_cost` khỏi
từng `item` trước khi trả ra client. Áp cho loader của `app/routes/shop/order-detail.tsx` (action không trả
`order` ra client nên không cần đổi). `admin/order-detail.tsx` (dùng `getOrderById`) và `notifyNewOrder`
(dùng `order` đầy đủ được truyền từ `createOrder` trong `checkout.tsx`, không qua route này) không đổi —
vẫn thấy đủ dữ liệu. Kiểm chứng: `npm run dev`, tra cứu đơn thật (`LUMI05644`/`0934567890`) lấy cookie ký
hợp lệ, `curl -b <cookie> http://localhost:5173/don-hang/LUMI05644.data | grep -oE "unit_cost|admin_note"`
→ không khớp gì (trước khi sửa sẽ khớp).

**Đã sửa Warning #2 (rate limit theo username/mã đơn)**: `admin/login.tsx` — chuyển đọc `request.formData()`
lên trước, thêm rate limit thứ hai `scope: "admin-login-user"` khoá theo `username` (lowercase, trim), chặn
nếu VƯỢT một trong hai (IP hoặc username). `shop/order-lookup.tsx` — tương tự, thêm `scope:
"order-lookup-code"` khoá theo `code` (đã uppercase). Không đổi ngưỡng số lần đã có, chỉ thêm một chiều
khoá mới.

**Đã sửa Warning #3 (fail-soft cart-write/checkout-order)**: thêm `checkRateLimitSoft()` trong
`app/lib/rate-limit.server.ts` — bọc `checkRateLimit()` gốc trong try/catch, lỗi thì `console.error` và trả
`{allowed: true, retryAfterSeconds: 0}` (fail-open). Áp cho `app/routes/shop/checkout.tsx` (đặt đơn) và
`app/routes/api.cart.ts` (giỏ hàng). `admin/login.tsx` và `order-lookup.tsx` **giữ nguyên** `checkRateLimit`
gốc (fail-closed — lỗi D1 sẽ ném ra ngoài, chặn luôn thao tác đó) theo đúng yêu cầu review. Migration 0007
đã xác nhận áp rồi ở local (`npm run db:migrate` → "No migrations to apply").

**Đã sửa Warning #4 (COOKIE_SECRET yếu)**: `getCookieSecret()` trong `recent-orders.server.ts` giờ từ chối
secret rỗng, ngắn hơn 32 ký tự, hoặc khớp đúng chuỗi mẫu trong `.dev.vars.example`
(`doi-chuoi-nay-thanh-gia-tri-ngau-nhien-dai-it-nhat-32-ky-tu`) — coi như thiếu secret (fail-closed, giống
hành vi cũ khi thiếu hẳn biến). Đã xác nhận secret thật ở `.dev.vars` máy này dài 43 ký tự → không bị ảnh
hưởng, dev vẫn chạy được bình thường.

**Đã sửa Warning #5 (SVG chỉ cho `demo/`)**: `app/routes/anh.ts` — tách `image/svg+xml` ra khỏi
`SAFE_IMAGE_TYPES`, thêm hàm `isSafeImageType(contentType, key)` chỉ chấp nhận SVG khi
`key.startsWith("demo/")`; các loại ảnh khác (jpeg/png/webp/avif) vẫn hợp lệ ở mọi prefix cho phép như cũ.

**Đã sửa Warning #6 (SSRF allowlist host + redirect manual)**: `app/lib/threads.server.ts` —
`isSafeExternalUrl()` giờ có thêm allowlist theo host (`*.amazonaws.com` hoặc `*.typefully.com`) sau các
điều kiện blocklist IP/localhost cũ. Không phải suy đoán mù: đã đọc lại commit `cc8cb16` ("Fix Threads
posts losing their images", verify với tài khoản Typefully thật) xác nhận `upload_url` Typefully trả về
là link **S3 ký sẵn kiểu SigV2** → domain thực tế luôn là `*.amazonaws.com`, nên allowlist này không phải
đoán mà dựa trên bằng chứng đã verify trong repo. Thêm `*.typefully.com` phòng khi họ đổi hạ tầng lưu trữ.
Đồng thời thêm `redirect: "manual"` cho lượt PUT ảnh lên S3 — coi `opaqueredirect`/3xx là lỗi (S3 hợp lệ
không bao giờ redirect cho URL ký sẵn). **Không sửa gì ở phần header của PUT** (giữ nguyên không gửi
`Content-Type`/`Authorization`) vì đó chính là điểm commit `cc8cb16` vừa vá — thêm header sẽ làm hỏng chữ
ký SigV2 và tái diễn bug "mất ảnh khi đăng Threads". Kiểm chứng: `npx tsc -b` sạch; không test được PoC
thật với tài khoản Typefully (không có quyền trong môi trường agent) — như T12 trước đó, đây là vá theo
đọc code + tài liệu/commit đã verify, không có PoC runtime.

**Đã sửa Warning #7 (dọn rate_limits theo xác suất)**: `checkRateLimit()` trong `rate-limit.server.ts` —
câu `DELETE` dọn cửa sổ cũ giờ chỉ chạy với xác suất ~1% (`Math.random() < 0.01`) mỗi lần gọi, thay vì mọi
lần gọi. Không đổi logic đếm/chặn, chỉ giảm số lượt ghi D1 phụ ở các hot path như `/api/gio-hang`.

**Bỏ qua (đã ghi nhận sẵn trong PLAN, không tự làm thêm)**: Finding #8, #9 (2 phát hiện của tester) và toàn
bộ Suggestion #10–16 — theo đúng phạm vi được giao cho vòng sửa này, không mở rộng.

File đã sửa thêm trong vòng này: `app/lib/order.server.ts`, `app/routes/shop/order-detail.tsx`,
`app/routes/admin/login.tsx`, `app/routes/shop/order-lookup.tsx`, `app/lib/rate-limit.server.ts`,
`app/routes/shop/checkout.tsx`, `app/routes/api.cart.ts`, `app/lib/recent-orders.server.ts`,
`app/routes/anh.ts`, `app/lib/threads.server.ts`.

Kiểm chứng chung: `npm run check` PASS (typegen + `tsc -b` + `react-router build` + `wrangler deploy
--dry-run`) sau toàn bộ thay đổi trên. `npm run db:migrate` xác nhận migration 0007 đã áp ở local trước
khi test T3/#3.

**Điểm tester cần chú ý ở vòng test lại**:
- Lặp lại ca B (IDOR) nhưng lần này thêm `curl ... /don-hang/<code>.data | grep -E "unit_cost|admin_note"`
  phải rỗng (đây là ca chính của Critical #1).
- Ca C (rate limit): thử brute force **cùng username khác IP** (ví dụ đổi `X-Forwarded-For` hoặc
  `CF-Connecting-IP` giả nếu môi trường test cho phép) để xác nhận khoá `admin-login-user` chặn được kể cả
  khi đổi IP; tương tự dò cùng một mã đơn bằng nhiều IP khác nhau cho `order-lookup-code`.
- Xác nhận luồng giỏ hàng/checkout **không** bị 500 nếu bảng `rate_limits` tạm thời không truy vấn được
  (không bắt buộc phải tự tạo lỗi D1 thật để test — có thể chỉ xác nhận bằng đọc code
  `checkRateLimitSoft`/try-catch nếu không có cách mô phỏng lỗi D1 dễ dàng trong môi trường test).
- Xác nhận `GET /anh/demo/<key>.svg` vẫn 200 (không hồi quy ảnh demo) và giả lập ý tưởng SVG ở
  `products/`/`settings/` (nếu có cách tạo object test trong R2 local) phải bị từ chối.
- Threads/SSRF (#6) không có cách test PoC runtime trong môi trường này — tester chỉ cần xác nhận đăng bài
  Threads thật (nếu có tài khoản test) vẫn tải ảnh lên thành công như trước (không hồi quy do thêm
  `redirect: "manual"`/allowlist host).

## Review findings vòng 2 (reviewer điền): APPROVED

Đã đối chiếu diff 10 file của vòng sửa với mô tả finding #1-7.

- **#1 (Critical) — đã vá đúng, không còn đường rò rỉ khác**: `toPublicOrder()` (`app/lib/order.server.ts:20-38`)
  bỏ `admin_note` + `unit_cost`, áp ở `shop/order-detail.tsx:52`. Đã rà hết các đường còn dùng
  `getOrderByCode`: action review của cùng route chỉ trả `reviewError`/`reviewMessage`;
  `order-lookup.tsx` chỉ redirect; `checkout.tsx:165` dùng bản đầy đủ nhưng chỉ cho `notifyNewOrder`
  (server-side); `getReviewableItems` không select `unit_cost`. Admin vẫn thấy đủ dữ liệu — không hồi quy.
- **#2-7 — khớp claim, không sinh lỗ hổng mới**: fail-soft (#3) chỉ trả `allowed: true` trong nhánh
  `catch` nên không tắt rate-limit thật, và login/order-lookup vẫn fail-closed đúng chủ ý; allowlist
  host (#6) dùng `endsWith` hậu tố thật + giữ blocklist IP + `redirect: "manual"`, không đụng header
  PUT nên không tái diễn bug `cc8cb16`; dọn 1% (#7) scope đúng theo scope đang gọi nên scope có traffic
  tự dọn được.
- **Không có Critical/High mới.** Verdict: **APPROVED**.

### Known issue mới phát hiện ở vòng 2 (không sửa vòng này — hết ngân sách 2 vòng theo CLAUDE.md)
1. `identifier` của `rate_limits` không giới hạn độ dài và do người dùng nhập (`order-lookup.tsx:35`
   `code`, `login.tsx:37` `username`), ở endpoint không cần đăng nhập, và vẫn INSERT dù IP đã vượt
   ngưỡng → rủi ro phình storage D1 (không rò rỉ dữ liệu). Sửa 1 dòng: `key.slice(0, 64)` trong
   `rate-limit.server.ts:61`. **Nên làm ngay sau release.**
2. Khoá rate limit theo username tính cả lần đăng nhập đúng → lockout DoS cho admin nếu biết username
   (8 request/5 phút là đủ). Hệ quả chấp nhận được của #2; hướng sửa sau: reset counter khi mật khẩu đúng.

### Prerequisite deploy (không phải bug)
`wrangler secret put COOKIE_SECRET` (>= 32 ký tự, khác chuỗi mẫu) + áp migration 0007 lên D1
production TRƯỚC khi deploy; verify lại HSTS/CSP trên domain https thật.

