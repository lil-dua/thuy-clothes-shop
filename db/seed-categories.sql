-- ============================================================================
-- Dữ liệu khởi tạo cho shop THẬT.
-- Chạy: npm run db:seed-categories            (local)
--       npm run db:seed-categories:remote     (Cloudflare)
--
-- Khác db/seed.sql ở chỗ: file này KHÔNG xoá gì và KHÔNG tạo sản phẩm mẫu.
-- Chỉ dựng sẵn danh mục và vài thiết lập vận hành để chủ shop bắt tay vào thêm
-- hàng thật được ngay.
--
-- Cố ý không đặt số tài khoản, số MoMo, hotline — những thứ đó phải là thông
-- tin thật, chủ shop tự điền trong trang Cài đặt. Để sẵn số giả ở đây thì rất
-- dễ quên mà đem đi bán hàng.
-- ============================================================================

INSERT INTO categories (slug, name, target_group, sort_order) VALUES
  ('vay-nu',           'Váy',      'women', 1),
  ('ao-nu',            'Áo',       'women', 2),
  ('quan-nu',          'Quần',     'women', 3),
  ('set-do-nu',        'Set đồ',   'women', 4),
  ('phu-kien-nu',      'Phụ kiện', 'women', 5),
  ('vay-tre-em',       'Váy',      'kids',  1),
  ('ao-tre-em',        'Áo',       'kids',  2),
  ('quan-tre-em',      'Quần',     'kids',  3),
  ('set-do-tre-em',    'Set đồ',   'kids',  4),
  ('phu-kien-tre-em',  'Phụ kiện', 'kids',  5)
ON CONFLICT(slug) DO NOTHING;

-- Thiết lập vận hành mặc định — sửa lại thoải mái trong trang Cài đặt
INSERT INTO settings (key, value) VALUES
  ('shipping_fee',            '30000'),
  ('free_shipping_threshold', '500000'),
  ('order_hold_minutes',      '30'),
  ('return_policy_days',      '7')
ON CONFLICT(key) DO NOTHING;
