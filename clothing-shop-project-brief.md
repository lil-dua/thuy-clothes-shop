# Dự án: Website quản lý tồn kho & bán quần áo

## 1. Bối cảnh
- Startup bán quần áo, hiện quảng bá qua tài khoản Threads, nhận đơn qua tin nhắn Threads.
- Mục tiêu: xây một website quản lý tồn kho (sản phẩm, size, số lượng, giá nhập, giá bán, lợi nhuận) mà khách cũng xem được, cộng thêm tự động hoá liên kết với Threads.

## 2. Yêu cầu chức năng
- Quản lý sản phẩm: tên, mô tả, ảnh (nhiều ảnh/sản phẩm), giá nhập, giá bán, tồn kho theo từng size.
- Trang công khai cho khách: xem sản phẩm, còn size nào, số lượng, giá.
- Giỏ hàng + checkout, 3 phương thức thanh toán: COD, chuyển khoản QR (VietQR), MoMo.
- Tự động: khi thêm sản phẩm mới (kèm ảnh) vào hệ thống → tự sinh và đăng bài lên Threads.
- Các ý tưởng tự động hoá khác — xem mục 8, giai đoạn 4.

## 3. Kiến trúc kỹ thuật — miễn phí, cho phép dùng thương mại
Dùng bộ Cloudflare thay vì Vercel: gói miễn phí (Hobby) của Vercel chỉ cho phép dùng phi thương mại, không hợp lệ cho một trang bán hàng thật.

| Thành phần | Công cụ | Vai trò |
|---|---|---|
| Hosting frontend | Cloudflare Pages | Host giao diện web, băng thông không giới hạn |
| Backend/API | Cloudflare Workers | Xử lý logic: tạo đơn, tạo QR thanh toán, gọi API đăng Threads |
| Database | Cloudflare D1 (SQLite) | Lưu sản phẩm, biến thể, đơn hàng — free 500MB |
| Lưu ảnh | Cloudflare R2 | Lưu ảnh sản phẩm — free 10GB, không tính phí băng thông tải ra |

Tất cả nằm trong 1 tài khoản Cloudflare, deploy qua Claude Code (Wrangler CLI).

## 4. Database schema (Cloudflare D1 / SQLite)

```sql
-- Sản phẩm (thông tin chung, không theo size)
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  cost_price INTEGER NOT NULL,      -- giá nhập, VND, số nguyên
  sale_price INTEGER NOT NULL,      -- giá bán
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'discontinued')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ảnh sản phẩm (nhiều ảnh/sản phẩm, sort_order đầu tiên = ảnh đại diện)
CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  r2_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Biến thể: mỗi dòng là 1 size (và màu, nếu có) với số lượng riêng
CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL,
  color TEXT,
  sku TEXT UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, size, color)
);

-- Khách hàng (tuỳ chọn, không bắt buộc đăng ký tài khoản)
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT,
  address TEXT,
  threads_handle TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Đơn hàng
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,        -- mã ngắn: tra cứu + nội dung chuyển khoản
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,            -- snapshot tại thời điểm đặt
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod', 'bank_transfer', 'momo')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled')),
  subtotal INTEGER NOT NULL,
  total INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chi tiết đơn — snapshot tên/giá/size tại thời điểm đặt
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_orders_status ON orders(order_status);
CREATE INDEX idx_orders_code ON orders(order_code);
CREATE INDEX idx_order_items_order ON order_items(order_id);
```

**Điểm thiết kế cần giữ khi code:**
- `order_items` lưu snapshot tên/giá/size tại thời điểm đặt — không chỉ tham chiếu `product_id`, để lịch sử đơn không sai lệch nếu sản phẩm gốc bị sửa/xoá sau.
- `order_code` (mã ngắn riêng) dùng làm nội dung chuyển khoản VietQR và để khách tra cứu — không lộ ID nội bộ.
- Sản phẩm dùng soft delete (cột `status`), không xoá cứng, để không phá vỡ đơn hàng cũ.
- Trừ tồn kho ngay khi tạo đơn (kể cả COD), kèm cơ chế giữ chỗ tự huỷ sau ~30 phút nếu đơn chuyển khoản/MoMo chưa xác nhận thanh toán — tránh 2 khách cùng giữ size cuối cùng.
- Giá lưu số nguyên (VND không có phần thập phân).

## 5. Thanh toán — 3 phương thức
- **COD**: không cần tích hợp, chỉ ghi nhận đơn, cập nhật trạng thái khi giao thành công.
- **Chuyển khoản QR**: dùng API tạo mã QR miễn phí của VietQR, tự điền sẵn số tiền + `order_code` vào nội dung chuyển khoản. Giai đoạn đầu xác nhận thanh toán thủ công — đối soát tự động cần gói trả phí của VietQR, để sau.
- **MoMo**: API chính thức (nhận thanh toán ví ngay trên web) cần tài khoản MoMo Doanh Nghiệp, có thể mất thời gian đăng ký/duyệt. MVP: hiển thị mã QR MoMo cá nhân tương tự cách làm với ngân hàng, xác nhận thủ công — nâng cấp API thật khi đã đăng ký hộ kinh doanh.

## 6. Tích hợp Threads
- **Chiều xuôi (làm trước)**: thêm sản phẩm mới kèm ảnh (lưu trong R2) → soạn caption từ dữ liệu sản phẩm → đăng lên Threads kèm ảnh, qua Typefully.
- **Chiều ngược (để sau)**: tự động thêm vào web khi có bài đăng mới trên Threads. Khả thi vì Meta đã mở API đọc bài + webhook cho Threads, nhưng cần đăng ký Meta Developer app, xác minh doanh nghiệp, chờ duyệt (khoảng vài tuần), và cần mẫu caption cố định để tách dữ liệu chính xác.

## 7. Domain
- Domain mặc định `*.pages.dev`: đổi tên project trong Cloudflare Pages để gọn hơn — miễn phí, làm ngay được.
- Domain riêng: mua qua Cloudflare Registrar (bán đúng giá gốc, không phí thêm) — có đuôi .shop/.com/.store hợp với shop quần áo. Cần dùng nameserver Cloudflare.
- .vn: đăng ký qua nhà đăng ký trong nước, cần giấy tờ/đăng ký kinh doanh theo quy định VNNIC, giá cao hơn domain quốc tế — để dành khi đã đăng ký hộ kinh doanh.
- Tên miền cụ thể: **chưa chọn**.

## 8. Kế hoạch theo giai đoạn

**Giai đoạn 0 — Chuẩn bị**
- Tạo tài khoản Cloudflare
- Chuẩn bị số tài khoản ngân hàng + mã QR MoMo cá nhân
- Kết nối Typefully

**Giai đoạn 1 — Nền tảng dữ liệu + trang xem tồn kho (MVP chỉ xem)**
- Tạo schema D1 (mục 4)
- Trang admin: thêm/sửa sản phẩm, upload ảnh lên R2
- Trang công khai: danh sách sản phẩm, tồn kho theo size, giá — chưa có giỏ hàng
- Deploy thử lên Cloudflare Pages

**Giai đoạn 2 — Giỏ hàng + checkout 3 phương thức**
- Giỏ hàng phía trình duyệt, bảng orders + order_items
- Trang checkout: chọn COD / VietQR / MoMo
- Trang admin: danh sách đơn, đánh dấu đã thanh toán/đã giao
- Tự trừ tồn kho theo size khi tạo đơn

**Giai đoạn 3 — Tự động đăng Threads (chiều xuôi)**
- Nút "Đăng lên Threads" trong trang admin, đính kèm ảnh, qua Typefully

**Giai đoạn 4 — Vận hành & tối ưu**
- Cảnh báo sắp hết hàng theo size
- Dashboard doanh thu/lợi nhuận tự tính
- Trang tra cứu đơn hàng bằng mã đơn cho khách
- Hoá đơn/biên nhận tự gửi sau khi xác nhận đơn

**Giai đoạn 5 — Để sau, không gấp**
- Chiều ngược Threads → web
- Nâng MoMo lên API chính thức
- Mã giảm giá, lưu thông tin khách quen, thống kê size bán chạy
- Domain riêng chính thức (.shop/.com trước, .vn sau nếu cần)

## 9. Việc còn cần quyết định
- Tên shop / tên miền cụ thể
- Có cần .vn ngay từ đầu không, hay dùng .shop/.com trước
- Lịch làm: buổi tối trong tuần hay dồn vào cuối tuần theo khối 3–4 tiếng/giai đoạn
