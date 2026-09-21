-- ==========================================
-- Schema: Clothing Shop Inventory + Orders (Cloudflare D1 / SQLite)
-- ==========================================

-- Sản phẩm (thông tin chung, không theo size)
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,                    -- áo, quần, váy... (tuỳ chọn, để lọc theo danh mục sau này)
  cost_price INTEGER NOT NULL,      -- giá nhập, đơn vị VND, số nguyên (không thập phân)
  sale_price INTEGER NOT NULL,      -- giá bán
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'discontinued')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ảnh sản phẩm (1 sản phẩm có nhiều ảnh, ảnh đầu tiên theo sort_order = ảnh đại diện)
CREATE TABLE product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  r2_key TEXT NOT NULL,             -- key/đường dẫn ảnh trong R2
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Biến thể sản phẩm: mỗi dòng là 1 size (và màu, nếu có) với số lượng riêng
CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL,               -- S, M, L, XL... hoặc số đo cụ thể
  color TEXT,                       -- để trống nếu chưa cần phân biệt màu
  sku TEXT UNIQUE,                  -- mã riêng từng biến thể, tuỳ chọn nhưng nên có
  quantity INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, size, color)
);

-- Khách hàng (tuỳ chọn — giúp nhận diện khách quen, không bắt buộc đăng ký tài khoản)
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
  order_code TEXT NOT NULL UNIQUE,        -- mã ngắn cho khách tra cứu + nội dung chuyển khoản, vd "DH0234"
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,            -- snapshot tại thời điểm đặt, dù customer đổi thông tin sau
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

-- Chi tiết từng sản phẩm trong đơn — snapshot tên/giá/size tại thời điểm đặt
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,       -- snapshot, không đổi dù sản phẩm gốc bị sửa/xoá sau này
  size TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

-- Index cho các truy vấn thường dùng
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_orders_status ON orders(order_status);
CREATE INDEX idx_orders_code ON orders(order_code);
CREATE INDEX idx_order_items_order ON order_items(order_id);
