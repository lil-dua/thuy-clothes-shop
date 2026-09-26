# Lumi — website bán quần áo nữ & trẻ em

Một worker Cloudflare phục vụ **cả hai giao diện**:

| Đường dẫn | Dành cho | Tối ưu cho |
|---|---|---|
| `/` … | Khách mua hàng — **không cần đăng nhập** | Điện thoại |
| `/admin` … | Chủ shop — **bắt buộc đăng nhập** | Laptop / PC |

Khi đã đăng nhập quản trị, storefront hiện một dải đen ở đầu trang kèm nút
**Trang quản trị** — đó là cách chuyển qua lại giữa hai giao diện.

## Giao diện

Ảnh dưới đây chụp từ dữ liệu mẫu. Chụp lại bất cứ lúc nào bằng `npm run screenshots`.

### Khách mua hàng — chụp ở khung điện thoại 390×844

| | | |
|:--:|:--:|:--:|
| <img src="screenshots/01-trang-chu.png" width="250" alt="Trang chủ"> | <img src="screenshots/02-trang-chu-san-pham.png" width="250" alt="Sản phẩm nổi bật"> | <img src="screenshots/03-danh-sach-nu.png" width="250" alt="Thời trang nữ"> |
| **Trang chủ** | **Sản phẩm nổi bật** | **Thời trang nữ** |
| <img src="screenshots/04-danh-sach-tre-em.png" width="250" alt="Trẻ em"> | <img src="screenshots/05-chi-tiet-san-pham.png" width="250" alt="Chi tiết sản phẩm"> | <img src="screenshots/06-chon-size-mau.png" width="250" alt="Chọn màu & size"> |
| **Trẻ em** | **Chi tiết sản phẩm** | **Chọn màu & size** |
| <img src="screenshots/07-gio-hang.png" width="250" alt="Giỏ hàng"> | <img src="screenshots/08-thanh-toan.png" width="250" alt="Thanh toán"> | <img src="screenshots/09-thanh-toan-phuong-thuc.png" width="250" alt="Phương thức thanh toán"> |
| **Giỏ hàng** | **Thanh toán** | **Phương thức thanh toán** |
| <img src="screenshots/10-tra-cuu-don-hang.png" width="250" alt="Tra cứu đơn"> | <img src="screenshots/11-theo-doi-don-hang.png" width="250" alt="Theo dõi đơn"> | <img src="screenshots/12-huong-dan-chuyen-khoan.png" width="250" alt="Quét mã VietQR"> |
| **Tra cứu đơn** | **Theo dõi đơn** | **Quét mã VietQR** |

### Quản trị — chụp ở khung laptop 1440×900

| | |
|:--:|:--:|
| <img src="screenshots/21-admin-tong-quan.png" width="420" alt="Tổng quan"> | <img src="screenshots/22-admin-san-pham.png" width="420" alt="Danh sách sản phẩm"> |
| **Tổng quan** | **Danh sách sản phẩm** |
| <img src="screenshots/23-admin-sua-san-pham.png" width="420" alt="Sửa sản phẩm & tồn kho theo size"> | <img src="screenshots/24-admin-dang-threads.png" width="420" alt="Đăng lên Threads"> |
| **Sửa sản phẩm & tồn kho theo size** | **Đăng lên Threads** |
| <img src="screenshots/25-admin-don-hang.png" width="420" alt="Đơn hàng"> | <img src="screenshots/26-admin-chi-tiet-don.png" width="420" alt="Chi tiết đơn"> |
| **Đơn hàng** | **Chi tiết đơn** |
| <img src="screenshots/27-admin-khach-hang.png" width="420" alt="Khách hàng"> | <img src="screenshots/28-admin-khuyen-mai.png" width="420" alt="Khuyến mãi"> |
| **Khách hàng** | **Khuyến mãi** |
| <img src="screenshots/29-admin-bao-cao.png" width="420" alt="Báo cáo"> | <img src="screenshots/30-admin-cai-dat.png" width="420" alt="Cài đặt"> |
| **Báo cáo** | **Cài đặt** |
| <img src="screenshots/20-admin-dang-nhap.png" width="420" alt="Đăng nhập quản trị"> |  |
| **Đăng nhập quản trị** |  |

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

Muốn có sẵn đơn hàng để xem trang quản trị (cần `npm run dev` đang chạy):

```bash
npm run db:seed-orders  # 6 đơn mẫu ở đủ các trạng thái
```

`db:reset` xoá sạch database local rồi dựng lại từ đầu, nên id luôn bắt đầu từ 1.
Nếu chỉ muốn nạp lại dữ liệu mẫu mà giữ database, dùng `npm run db:seed`.

> **Nhớ khởi động lại `npm run dev` sau mỗi lần `db:reset` / `db:seed`.** Worker
> đang giữ tệp SQLite local; ghi đè tệp đó khi server còn chạy sẽ làm mọi truy
> vấn tiếp theo báo `internal error`.

## Lệnh thường dùng

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy dev server |
| `npm run typecheck` | Sinh type cho bindings + route rồi kiểm tra TypeScript |
| `npm run build` | Build production |
| `npm run db:migrate` | Áp migration lên database local |
| `npm run db:seed` | Nạp dữ liệu mẫu + ảnh minh hoạ (local) |
| `npm run db:seed-orders` | Tạo đơn hàng mẫu qua đúng luồng thanh toán thật |
| `npm run db:reset` | Xoá và dựng lại database local từ đầu |
| `npm run admin:create -- <user> <pass> "<tên>"` | Tạo / đổi mật khẩu tài khoản quản trị |
| `npm run db:studio -- "SELECT ..."` | Chạy một câu SQL trên database local |
| `npm run screenshots` | Chụp lại toàn bộ ảnh trong `screenshots/` |

## Đưa lên Cloudflare

Shop đang chạy tại **https://thuyshop.huuthom0209.workers.dev**

Có hai đường deploy, cùng trỏ tới một Worker tên `thuyshop`:

- **Tự động** — Cloudflare Workers Builds theo dõi nhánh `main` trên GitHub,
  push lên là build và deploy.
- **Thủ công** — `npm run deploy` từ máy.

Tên Worker trong `wrangler.json` phải khớp tên project bên Cloudflare, nếu không
`npm run deploy` sẽ tạo ra một Worker thứ hai và shop chạy song song ở hai nơi.

### Dựng lại từ đầu trên một tài khoản khác

```bash
npx wrangler login

npx wrangler d1 create lumi-shop-db          # chép database_id vào wrangler.json
npx wrangler r2 bucket create lumi-shop-images

npm run db:migrate:remote                    # tạo bảng
npm run db:seed-categories:remote            # danh mục + phí ship mặc định
npm run admin:create -- <user> '<mật khẩu>' '<Tên>' --remote
npm run deploy
```

R2 phải được **bật một lần trong dashboard** trước khi tạo bucket được — CLI báo
`code: 10042` nếu chưa bật. Gói 10GB đầu miễn phí nhưng Cloudflare vẫn hỏi
phương thức thanh toán.

Dùng `db:seed-categories` chứ đừng dùng `db:seed` cho shop thật: `db:seed` xoá
sạch bảng và nhồi sản phẩm mẫu kèm số tài khoản giả.

Sau khi deploy, vào **Cài đặt** trong trang quản trị điền số tài khoản ngân
hàng, số MoMo, hotline — chưa điền thì phương thức thanh toán tương ứng tự ẩn ở
trang thanh toán.

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
scripts/           Tạo tài khoản quản trị, nạp dữ liệu mẫu, chụp ảnh README
screenshots/       Ảnh preview, sinh bằng `npm run screenshots`
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

**API key không bao giờ rời server.** Khoá Typefully nằm trong bảng `settings`
nhưng cố ý không có trong `DEFAULT_SETTINGS`, nên `getSettings()` không đọc ra
nó và loader trang Cài đặt không thể vô tình gửi xuống trình duyệt. Đọc/ghi phải
đi qua `getSecret` / `setSecret`. Giao diện chỉ hiện "đã cấu hình", không hiện
giá trị.

## Đăng bài Threads

Đi qua **Typefully** thay vì gọi thẳng API Threads của Meta: API chính chủ đòi
đăng ký Meta Developer app và xác minh doanh nghiệp, chờ vài tuần. Typefully chỉ
cần một API key.

Cách bật:

1. Vào Typefully → **Settings → API**, tạo một API key
2. Mở **Cài đặt → Đăng bài Threads** trong trang quản trị, dán khoá vào
   (khoá được gọi thử với Typefully trước khi lưu — dán sai là biết ngay)
3. Bấm **Nạp danh sách tài khoản**, chọn tài khoản Threads sẽ đăng
4. Sửa mẫu caption nếu muốn, bật **Tự đăng khi thêm sản phẩm mới** nếu cần

Sau đó mỗi trang sửa sản phẩm có khối **Đăng lên Threads**: caption soạn sẵn từ
mẫu (chỉ lấy size và màu còn hàng), sửa tay thoải mái, rồi chọn một trong ba:

- **Hẹn giờ đăng** — chọn ngày giờ (hoặc bấm nhanh *Tối nay 20:00*, *Sáng mai
  10:00*, *Tối mai 20:00*). Typefully giữ bài và tự đăng đúng mốc đó.
- **Đăng ngay**
- **Chỉ lưu nháp** — bài nằm ở mục nháp trên Typefully để xem lại rồi tự bấm đăng

Bài kèm tối đa 4 ảnh đầu tiên của sản phẩm, đọc thẳng từ R2.

### Hẹn giờ hoạt động thế nào

Việc **giữ bài và đăng đúng giờ là của Typefully**, không phải của worker này —
API nhận `publish_at` là một mốc ISO có múi giờ và họ lo phần còn lại. Nghĩa là
bài vẫn lên đúng giờ kể cả khi shop không có ai online, và không cần dựng hàng
đợi riêng.

Giờ nhập vào luôn được hiểu là **giờ Việt Nam**, kể cả khi chủ shop đang ngồi ở
múi giờ khác — cho khớp với mọi thời gian khác trong hệ thống. Ô nhập chặn mốc
quá khứ, server kiểm lại lần nữa trước khi gọi API.

Bài đã hẹn hiện ở hai nơi: khối lịch sử ngay dưới sản phẩm, và một khối tổng hợp
trên trang **Tổng quan**. Huỷ được bất cứ lúc nào trước giờ đăng — bản nháp bên
Typefully cũng bị xoá theo.

Một **cron chạy 15 phút một lần** (khai báo trong `wrangler.json`) hỏi lại
Typefully xem bài đã lên sóng chưa rồi cập nhật trạng thái; cron *không* đăng
hộ, chỉ để trang quản trị không hiển thị "Đã hẹn giờ" mãi sau khi bài đã đăng.
Tiện thể cron cũng trả kho cho đơn quá hạn giữ chỗ — trước đây việc này chỉ chạy
khi có người vào web, nên cả đêm không ai ghé là hàng bị giữ treo tới sáng.

> Cron không chạy ở `npm run dev`, chỉ chạy trên Cloudflare. Lần deploy vừa rồi
> đã đăng ký `schedule: */15 * * * *`; xem lại ở dashboard → Workers → thuyshop
> → Settings → Trigger Events.

Mọi lần đăng đều ghi vào bảng `social_posts` — thành công hay thất bại, kèm
caption và thông báo lỗi — nên lịch sử đăng luôn tra được ngay dưới khối đó.
Ảnh lỗi không làm hỏng cả bài: phần chữ vẫn được đăng, lỗi ảnh ghi lại riêng.

Muốn giữ khoá ngoài database thì đặt làm secret của Cloudflare, code ưu tiên đọc
biến môi trường trước bảng `settings`:

```bash
npx wrangler secret put TYPEFULLY_API_KEY
```

## Đánh giá sản phẩm

Chỉ khách **đã mua và đã nhận hàng** mới đánh giá được: biểu mẫu nằm trong trang
theo dõi đơn, mà trang đó chỉ mở cho trình duyệt vừa đặt đơn hoặc vừa nhập đúng
số điện thoại. Nhờ vậy không cần captcha, không cần bước duyệt trước, và mỗi
đánh giá đều gắn với một đơn có thật.

Mỗi đơn đánh giá một sản phẩm một lần; gửi lại thì ghi đè đánh giá cũ. Chủ shop
xem và ẩn/xoá trong **Quản trị → Đánh giá**; đánh giá bị ẩn biến mất khỏi trang
sản phẩm nhưng vẫn còn trong database.

## Email xác nhận đơn

Dùng **Resend** (miễn phí 3.000 thư/tháng). MailChannels — thứ hay được giới
thiệu là miễn phí cho Workers — đã ngừng dịch vụ đó từ 30/6/2024.

Ô email ở trang thanh toán **không bắt buộc**: khách Việt đặt qua Threads phần
lớn chỉ để lại số điện thoại, bắt nhập email là mất đơn. Có email thì khách nhận
thư xác nhận kèm mã QR chuyển khoản; chủ shop nhận thư báo đơn mới.

Bật trong **Cài đặt → Email xác nhận đơn**: dán API key, điền địa chỉ gửi, bấm
**Gửi thử** để kiểm tra trước khi tin.

> Resend đòi **domain đã xác minh** mới cho gửi tới địa chỉ bất kỳ. Chưa có
> domain riêng thì chỉ gửi được tới chính email đã đăng ký tài khoản Resend —
> đủ để nhận báo đơn mới, chưa đủ để gửi cho khách.

Việc gửi chạy nền bằng `ctx.waitUntil`, nên khách không phải đợi Resend trả lời
mới thấy trang cảm ơn. Mail hỏng **không bao giờ** làm hỏng việc đặt hàng — đơn
đã nằm trong database rồi. Mọi lần gửi, kể cả bỏ qua vì chưa cấu hình, đều ghi
vào bảng `email_log` kèm nguyên nhân.

## Chưa làm (theo kế hoạch trong `docs/`)

- Chiều ngược Threads → web (giai đoạn 5)
- Đối soát chuyển khoản tự động — hiện xác nhận thủ công trong trang đơn hàng
- API MoMo chính thức — hiện dùng QR cá nhân, xác nhận thủ công
- Domain riêng
