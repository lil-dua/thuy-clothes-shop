# Lumi — website bán quần áo nữ & trẻ em

Một worker Cloudflare phục vụ **cả hai giao diện**:

| Đường dẫn | Dành cho | Tối ưu cho |
|---|---|---|
| `/` … | Khách mua hàng — **không cần đăng nhập** | Điện thoại |
| `/admin` … | Chủ shop — **bắt buộc đăng nhập** | Laptop / PC |

Khi đã đăng nhập quản trị, storefront hiện một dải đen ở đầu trang kèm nút
**Trang quản trị** — đó là cách chuyển qua lại giữa hai giao diện.

## Công nghệ

React Router v7 (SSR) · Cloudflare Workers · D1 (SQLite) · R2 (ảnh) · Tailwind CSS v4 · TypeScript

Tất cả đều nằm trong gói miễn phí của Cloudflare và **được phép dùng cho mục đích
thương mại** — khác với gói Hobby của Vercel.

## Chạy ở máy

```bash
npm install
npm run db:reset        # tạo database local + dữ liệu mẫu + ảnh minh hoạ
npm run admin:create -- thuy 'MatKhauManh!2026' 'Chị Thuý'
npm run dev             # http://localhost:5173
```

`db:reset` xoá sạch database local rồi dựng lại từ đầu, nên id luôn bắt đầu từ 1.
Nếu chỉ muốn nạp lại dữ liệu mẫu mà giữ database, dùng `npm run db:seed`.

## Lệnh thường dùng

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy dev server |
| `npm run typecheck` | Sinh type cho bindings + route rồi kiểm tra TypeScript |
| `npm run build` | Build production |
| `npm run db:migrate` | Áp migration lên database local |
| `npm run db:seed` | Nạp dữ liệu mẫu + ảnh minh hoạ (local) |
| `npm run db:reset` | Xoá và dựng lại database local từ đầu |
| `npm run admin:create -- <user> <pass> "<tên>"` | Tạo / đổi mật khẩu tài khoản quản trị |
| `npm run db:studio -- "SELECT ..."` | Chạy một câu SQL trên database local |

## Đưa lên Cloudflare

Cần một tài khoản Cloudflare (miễn phí). Các bước chỉ làm một lần:

```bash
npx wrangler login

# 1. Tạo database và bucket ảnh
npx wrangler d1 create lumi-shop-db
npx wrangler r2 bucket create lumi-shop-images
```

Lệnh `d1 create` in ra `database_id`. Dán giá trị đó vào `wrangler.json`, thay cho
`PLACEHOLDER_CHAY_WRANGLER_D1_CREATE`.

```bash
# 2. Tạo bảng trên database thật
npm run db:migrate:remote

# 3. Tạo tài khoản quản trị trên database thật
npm run admin:create -- thuy 'MatKhauManh!2026' 'Chị Thuý' --remote

# 4. Deploy
npm run deploy
```

Sau khi deploy, vào **Cài đặt** trong trang quản trị để điền số tài khoản ngân
hàng, số MoMo, phí vận chuyển — chưa điền thì phương thức thanh toán tương ứng
sẽ tự ẩn ở trang thanh toán.

Ảnh minh hoạ `demo/*` chỉ dùng để xem thử; xoá dữ liệu mẫu và tải ảnh thật lên
trong trang quản trị khi bắt đầu bán.

## Cấu trúc

```
app/
  routes/shop/     Storefront: trang chủ, danh sách, chi tiết, giỏ, thanh toán, tra cứu đơn
  routes/admin/    Quản trị: tổng quan, sản phẩm, đơn hàng, khách hàng, khuyến mãi, báo cáo, cài đặt
  routes/anh.ts    Phục vụ ảnh từ R2 (cache 1 năm + ETag)
  components/      UI dùng chung cho từng khu vực
  lib/             *.server.ts = chỉ chạy ở server; còn lại dùng chung
db/
  migrations/      Lịch sử thay đổi schema
  seed.sql         Dữ liệu mẫu
scripts/           Tạo tài khoản quản trị, nạp ảnh minh hoạ
docs/              Bản brief gốc của dự án
```

Quy ước: file `*.server.ts` chỉ được import **kiểu** (`import type`) từ component.
Import một giá trị runtime sẽ kéo mã server vào bundle trình duyệt và build sẽ báo lỗi.

## Những quyết định đáng nhớ

**Phân loại nữ / trẻ em** đi qua bảng `categories` (mỗi danh mục thuộc một
`target_group`), không phải một cột trên `products`. Nhờ vậy "Váy" của đồ nữ và
"Váy" của trẻ em là hai danh mục riêng, và thêm nhóm mới sau này không phải sửa
schema.

**Đơn hàng lưu snapshot** tên, giá bán, giá nhập, size, ảnh tại thời điểm đặt.
Sửa hay gỡ bán sản phẩm không làm sai lệch lịch sử đơn và báo cáo lợi nhuận.

**Size đã từng bán thì không xoá cứng** — chỉ ẩn (`is_active = 0`), vì
`order_items` còn tham chiếu tới nó. Size chưa từng xuất hiện trong đơn nào mới
bị xoá hẳn.

**Tồn kho trừ ngay khi tạo đơn**, kể cả COD. Đơn chuyển khoản/MoMo được giữ chỗ
30 phút (sửa được trong Cài đặt); quá hạn thì tự huỷ và hoàn kho. Việc dọn chạy
ngay trong request khi mở trang sản phẩm, giỏ hàng, thanh toán hoặc trang quản
trị — không cần cron riêng.

**Đơn trả trước phải xác nhận đã nhận tiền** rồi mới chuyển sang giao hàng.

**Trang chi tiết đơn không mở công khai.** Mã đơn chỉ có 5 chữ số nên dò được,
mà trang này chứa tên, số điện thoại và địa chỉ khách. Vì vậy chỉ trình duyệt vừa
đặt đơn (cookie `lumi_orders`) hoặc vừa nhập đúng số điện thoại ở trang tra cứu
mới xem được.

**Mọi số tiền tính lại ở server** từ dữ liệu trong D1. Giá, phí ship, giảm giá
gửi lên từ trình duyệt đều bị bỏ qua.

## Chưa làm (theo kế hoạch trong `docs/`)

- Tự động đăng bài Threads khi thêm sản phẩm (giai đoạn 3)
- Chiều ngược Threads → web (giai đoạn 5)
- Đối soát chuyển khoản tự động — hiện xác nhận thủ công trong trang đơn hàng
- API MoMo chính thức — hiện dùng QR cá nhân, xác nhận thủ công
- Domain riêng
