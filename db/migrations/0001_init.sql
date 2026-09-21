-- ============================================================================
-- Lumi Shop — Migration 0001: khởi tạo toàn bộ schema
-- Cloudflare D1 (SQLite)
--
-- Nguyên tắc thiết kế giữ nguyên từ bản brief gốc (docs/clothing-shop-project-brief.md):
--   • order_items lưu SNAPSHOT tên/giá/size tại thời điểm đặt, không chỉ tham chiếu FK
--   • order_code là mã ngắn công khai — dùng cho nội dung chuyển khoản + tra cứu
--   • sản phẩm soft delete qua cột status, không xoá cứng
--   • giá lưu INTEGER (VND không có phần thập phân)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- Danh mục — gắn với nhóm đối tượng: đồ nữ / đồ trẻ em
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,          -- 'vay-nu', 'ao-be-gai'...
  name         TEXT NOT NULL,                 -- 'Váy', 'Áo'
  target_group TEXT NOT NULL CHECK (target_group IN ('women', 'kids')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Sản phẩm
-- ----------------------------------------------------------------------------
CREATE TABLE products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,          -- URL thân thiện, sinh từ tên (bỏ dấu)
  name         TEXT NOT NULL,
  description  TEXT,
  detail       TEXT,                          -- chất liệu, hướng dẫn giặt... (tab "Thông tin chi tiết")
  category_id  INTEGER REFERENCES categories(id),
  cost_price   INTEGER NOT NULL DEFAULT 0,    -- giá nhập (VND) — chỉ admin thấy
  sale_price   INTEGER NOT NULL,              -- giá bán hiện tại
  compare_price INTEGER,                      -- giá gốc gạch ngang, để trống nếu không giảm
  is_featured  INTEGER NOT NULL DEFAULT 0,    -- hiện ở "Sản phẩm nổi bật" trang chủ
  sold_count   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'hidden', 'discontinued')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Ảnh sản phẩm — nhiều ảnh/sản phẩm, sort_order nhỏ nhất = ảnh đại diện
-- ----------------------------------------------------------------------------
CREATE TABLE product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL,                  -- key trong R2 bucket IMAGES
  color       TEXT,                           -- gắn ảnh với 1 màu cụ thể (để trống = ảnh chung)
  alt         TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- Biến thể: mỗi dòng = 1 tổ hợp (size, màu) với tồn kho riêng
-- ----------------------------------------------------------------------------
CREATE TABLE product_variants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size        TEXT NOT NULL,                  -- nữ: S/M/L/XL — trẻ em: 2-3T, 90cm...
  color       TEXT,
  color_hex   TEXT,                           -- mã màu hiển thị swatch, vd '#F7C6D9'
  sku         TEXT UNIQUE,
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- Biến thể đã có trong đơn cũ thì không xoá cứng được (order_items tham chiếu
  -- tới nó). Khi chủ shop bỏ một size, biến thể được ẩn đi thay vì xoá.
  is_active   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, size, color)
);

-- ----------------------------------------------------------------------------
-- Khách hàng — KHÔNG bắt buộc đăng ký, chỉ để nhận diện khách quen theo SĐT
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT,
  phone          TEXT UNIQUE,
  address        TEXT,
  threads_handle TEXT,
  note           TEXT,
  order_count    INTEGER NOT NULL DEFAULT 0,
  total_spent    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Mã giảm giá
-- ----------------------------------------------------------------------------
CREATE TABLE discount_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  description   TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'amount')),
  discount_value INTEGER NOT NULL,            -- percent: 10 = 10%  |  amount: VND
  max_discount  INTEGER,                      -- trần giảm khi tính theo %
  min_order     INTEGER NOT NULL DEFAULT 0,   -- giá trị đơn tối thiểu
  usage_limit   INTEGER,                      -- NULL = không giới hạn
  used_count    INTEGER NOT NULL DEFAULT 0,
  starts_at     TEXT,
  ends_at       TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Đơn hàng
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code       TEXT NOT NULL UNIQUE,      -- vd 'LUMI12345' — nội dung CK + tra cứu
  customer_id      INTEGER REFERENCES customers(id),
  customer_name    TEXT NOT NULL,             -- snapshot lúc đặt
  customer_phone   TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('cod', 'bank_transfer', 'momo')),
  payment_status   TEXT NOT NULL DEFAULT 'pending'
                     CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  order_status     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled')),
  subtotal         INTEGER NOT NULL,
  shipping_fee     INTEGER NOT NULL DEFAULT 0,
  discount_code    TEXT,                      -- snapshot mã đã dùng
  discount_amount  INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL,
  note             TEXT,
  admin_note       TEXT,
  -- Giữ chỗ tồn kho: đơn CK/MoMo chưa thanh toán sẽ tự huỷ & hoàn kho sau mốc này
  reserved_until   TEXT,
  paid_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Chi tiết đơn — snapshot đầy đủ, không phụ thuộc sản phẩm gốc
-- ----------------------------------------------------------------------------
CREATE TABLE order_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id           INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_variant_id INTEGER REFERENCES product_variants(id),
  product_id         INTEGER REFERENCES products(id),
  product_name       TEXT NOT NULL,           -- snapshot
  product_slug       TEXT,
  image_r2_key       TEXT,                    -- snapshot ảnh đại diện
  size               TEXT NOT NULL,
  color              TEXT,
  unit_price         INTEGER NOT NULL,        -- snapshot giá bán
  unit_cost          INTEGER NOT NULL DEFAULT 0, -- snapshot giá nhập → tính lợi nhuận về sau
  quantity           INTEGER NOT NULL,
  line_total         INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- Đánh giá sản phẩm
-- ----------------------------------------------------------------------------
CREATE TABLE product_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id),
  author_name TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content     TEXT,
  is_visible  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Tài khoản quản trị + phiên đăng nhập
-- Khách mua hàng KHÔNG cần tài khoản; bảng này chỉ dành cho admin.
-- ----------------------------------------------------------------------------
CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                -- PBKDF2-SHA256, định dạng: pbkdf2$<iter>$<salt_b64>$<hash_b64>
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_sessions (
  token         TEXT PRIMARY KEY,             -- random 32 byte, hex
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Cấu hình shop (key/value) — số tài khoản, phí ship, ngưỡng freeship...
-- ----------------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- Index
-- ----------------------------------------------------------------------------
CREATE INDEX idx_categories_group    ON categories(target_group, sort_order);
CREATE INDEX idx_products_status     ON products(status);
CREATE INDEX idx_products_category   ON products(category_id, status);
CREATE INDEX idx_products_featured   ON products(is_featured, status);
CREATE INDEX idx_images_product      ON product_images(product_id, sort_order);
CREATE INDEX idx_variants_product    ON product_variants(product_id);
CREATE INDEX idx_orders_status       ON orders(order_status);
CREATE INDEX idx_orders_created      ON orders(created_at);
CREATE INDEX idx_orders_phone        ON orders(customer_phone);
CREATE INDEX idx_orders_reserved     ON orders(reserved_until);
CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_reviews_product     ON product_reviews(product_id, is_visible);
CREATE INDEX idx_sessions_user       ON admin_sessions(admin_user_id);
CREATE INDEX idx_sessions_expires    ON admin_sessions(expires_at);
