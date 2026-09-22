-- ============================================================================
-- Dữ liệu mẫu để chạy thử và xem giao diện.
-- Chạy: npm run db:seed          (database local)
--
-- KHÔNG chạy file này trên database thật sau khi đã có hàng và đơn thật.
-- File không tạo tài khoản quản trị — dùng `npm run admin:create` cho việc đó,
-- để không có mật khẩu nào bị commit vào repo.
-- ============================================================================

DELETE FROM social_posts;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM product_reviews;
DELETE FROM product_variants;
DELETE FROM product_images;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM customers;
DELETE FROM discount_codes;
-- Cố ý KHÔNG xoá bảng settings: nạp lại dữ liệu mẫu không nên
-- thổi bay API key và thông tin tài khoản nhận tiền chủ shop đã nhập.

-- ---------------------------------------------------------------------------
-- Danh mục — tách theo hai nhóm đối tượng chính của shop
-- ---------------------------------------------------------------------------
INSERT INTO categories (id, slug, name, target_group, sort_order) VALUES
  (1, 'vay-nu',            'Váy',       'women', 1),
  (2, 'ao-nu',             'Áo',        'women', 2),
  (3, 'quan-nu',           'Quần',      'women', 3),
  (4, 'set-do-nu',         'Set đồ',    'women', 4),
  (5, 'phu-kien-nu',       'Phụ kiện',  'women', 5),
  (6, 'vay-tre-em',        'Váy',       'kids',  1),
  (7, 'ao-tre-em',         'Áo',        'kids',  2),
  (8, 'quan-tre-em',       'Quần',      'kids',  3),
  (9, 'set-do-tre-em',     'Set đồ',    'kids',  4),
  (10, 'phu-kien-tre-em',  'Phụ kiện',  'kids',  5);

-- ---------------------------------------------------------------------------
-- Cấu hình shop
-- ---------------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('shop_name', 'Lumi'),
  ('shop_tagline', 'Thời trang cho những khoảnh khắc đẹp nhất'),
  ('shop_phone', '0987654321'),
  ('shop_email', 'hello@lumi.shop'),
  ('threads_handle', 'lumi.shop'),
  ('bank_id', 'VCB'),
  ('bank_account_no', '1234567890'),
  ('bank_account_name', 'NGUYEN THI THUY'),
  ('momo_phone', '0987654321'),
  ('momo_name', 'NGUYEN THI THUY'),
  ('shipping_fee', '30000'),
  ('free_shipping_threshold', '500000'),
  ('order_hold_minutes', '30'),
  ('return_policy_days', '7')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- ---------------------------------------------------------------------------
-- Sản phẩm — đồ nữ
-- ---------------------------------------------------------------------------
INSERT INTO products (id, slug, name, description, detail, category_id, cost_price, sale_price, compare_price, is_featured, sold_count) VALUES
  (1, 'dam-hoa-nhi-tay-bong', 'Đầm hoa nhí tay bồng',
   'Đầm hoa nhí với thiết kế tay bồng nữ tính, chất liệu vải voan mềm mại, thoáng mát phù hợp cho nhiều dịp: đi chơi, dạo phố, hẹn hò.',
   'Chất liệu: voan hoa lót lụa
Bảng size: S (45–50kg), M (50–55kg), L (55–60kg), XL (60–65kg)
Hướng dẫn: giặt máy chế độ nhẹ, không dùng chất tẩy',
   1, 165000, 289000, 359000, 1, 48),

  (2, 'dam-maxi-2-day', 'Đầm maxi 2 dây',
   'Đầm maxi dáng dài với hai dây mảnh, tôn dáng và mát mẻ cho mùa hè.',
   'Chất liệu: lụa tằm nhân tạo
Bảng size: S, M, L
Hướng dẫn: giặt tay với nước lạnh', 1, 190000, 329000, NULL, 1, 31),

  (3, 'dam-lua-co-vuong', 'Đầm lụa cổ vuông',
   'Đầm lụa cổ vuông thanh lịch, phù hợp đi làm và dự tiệc nhẹ.',
   'Chất liệu: lụa cao cấp
Bảng size: S, M, L', 1, 150000, 259000, 299000, 1, 27),

  (4, 'dam-babydoll-trang', 'Đầm babydoll trắng',
   'Đầm babydoll trắng dáng suông trẻ trung, dễ phối phụ kiện.',
   'Chất liệu: cotton pha
Bảng size: S, M, L', 1, 115000, 199000, NULL, 1, 64),

  (5, 'ao-thun-basic', 'Áo thun basic',
   'Áo thun cotton 100% form rộng vừa phải, dễ mặc hằng ngày.',
   'Chất liệu: cotton 100%
Bảng size: S, M, L, XL', 2, 95000, 199000, NULL, 1, 92),

  (6, 'ao-so-mi-lua-tay-dai', 'Áo sơ mi lụa tay dài',
   'Sơ mi lụa mềm rũ, form basic dễ phối với chân váy hoặc quần âu.',
   'Chất liệu: lụa satin
Bảng size: S, M, L', 2, 130000, 249000, NULL, 0, 18),

  (7, 'quan-jean-ong-rong', 'Quần jean ống rộng',
   'Quần jean ống rộng lưng cao, tôn dáng và che khuyết điểm bắp chân.',
   'Chất liệu: denim co giãn nhẹ
Bảng size: 26, 27, 28, 29', 3, 180000, 309000, 359000, 0, 22),

  (8, 'chan-vay-xep-ly', 'Chân váy xếp ly',
   'Chân váy xếp ly dáng midi, đi học đi làm đều hợp.',
   'Chất liệu: vải tuyết mưa
Bảng size: S, M, L', 3, 110000, 219000, NULL, 0, 14),

  (9, 'set-ao-quan-linen', 'Set áo quần linen',
   'Set hai món chất linen thoáng mát, mặc nhà hoặc đi biển đều đẹp.',
   'Chất liệu: linen tự nhiên
Bảng size: M, L', 4, 210000, 379000, 429000, 0, 11),

-- ---------------------------------------------------------------------------
-- Sản phẩm — đồ trẻ em
-- ---------------------------------------------------------------------------
  (10, 'vay-cong-chua-be-gai', 'Váy công chúa bé gái',
   'Váy công chúa xoè nhẹ có lớp lót mềm, bé mặc không bị ngứa.',
   'Chất liệu: voan lót cotton
Bảng size theo tuổi: 2-3T, 3-4T, 4-5T, 5-6T', 6, 125000, 229000, 279000, 1, 38),

  (11, 'set-do-be-gai-2-6-tuoi', 'Set đồ bé gái 2-6 tuổi',
   'Set áo và quần cotton mềm cho bé gái, thấm hút mồ hôi tốt.',
   'Chất liệu: cotton 100%
Bảng size theo tuổi: 2-3T, 3-4T, 4-5T, 5-6T', 9, 240000, 459000, NULL, 1, 26),

  (12, 'ao-thun-be-trai-in-hinh', 'Áo thun bé trai in hình',
   'Áo thun cotton in hình dễ thương, không bong tróc sau nhiều lần giặt.',
   'Chất liệu: cotton 4 chiều
Bảng size theo tuổi: 1-2T, 2-3T, 3-4T, 5-6T', 7, 68000, 139000, NULL, 0, 45),

  (13, 'quan-short-kaki-be', 'Quần short kaki bé',
   'Quần short kaki lưng thun co giãn, bé vận động thoải mái.',
   'Chất liệu: kaki mềm
Bảng size theo tuổi: 2-3T, 3-4T, 4-5T', 8, 72000, 149000, NULL, 0, 29),

  (14, 'mu-vanh-tron-be-gai', 'Mũ vành tròn bé gái',
   'Mũ vành tròn chống nắng, có dây buộc cằm không lo rơi.',
   'Chất liệu: cotton lót lưới
Size: một size cho bé 2-6 tuổi', 10, 45000, 99000, 129000, 0, 33);

-- ---------------------------------------------------------------------------
-- Biến thể (size + màu + tồn kho)
-- ---------------------------------------------------------------------------
INSERT INTO product_variants (product_id, size, color, color_hex, quantity, sort_order) VALUES
  -- 1. Đầm hoa nhí tay bồng
  (1, 'S',  'Hồng pastel', '#F7C6D9', 6, 1),
  (1, 'M',  'Hồng pastel', '#F7C6D9', 9, 2),
  (1, 'L',  'Hồng pastel', '#F7C6D9', 4, 3),
  (1, 'XL', 'Hồng pastel', '#F7C6D9', 0, 4),
  (1, 'S',  'Xanh mint',   '#BFE3DA', 3, 5),
  (1, 'M',  'Xanh mint',   '#BFE3DA', 7, 6),
  (1, 'L',  'Xanh mint',   '#BFE3DA', 2, 7),
  -- 2. Đầm maxi 2 dây
  (2, 'S', 'Be',   '#E8D8C3', 5, 1),
  (2, 'M', 'Be',   '#E8D8C3', 8, 2),
  (2, 'L', 'Be',   '#E8D8C3', 3, 3),
  (2, 'S', 'Đen',  '#2E282D', 4, 4),
  (2, 'M', 'Đen',  '#2E282D', 6, 5),
  -- 3. Đầm lụa cổ vuông
  (3, 'S', 'Trắng',      '#FFFFFF', 7, 1),
  (3, 'M', 'Trắng',      '#FFFFFF', 5, 2),
  (3, 'L', 'Trắng',      '#FFFFFF', 2, 3),
  (3, 'M', 'Xanh navy',  '#33415C', 4, 4),
  (3, 'L', 'Xanh navy',  '#33415C', 3, 5),
  -- 4. Đầm babydoll trắng
  (4, 'S', 'Trắng', '#FFFFFF', 10, 1),
  (4, 'M', 'Trắng', '#FFFFFF', 12, 2),
  (4, 'L', 'Trắng', '#FFFFFF',  6, 3),
  -- 5. Áo thun basic
  (5, 'S',  'Trắng', '#FFFFFF', 15, 1),
  (5, 'M',  'Trắng', '#FFFFFF', 20, 2),
  (5, 'L',  'Trắng', '#FFFFFF', 14, 3),
  (5, 'XL', 'Trắng', '#FFFFFF',  8, 4),
  (5, 'M',  'Đen',   '#2E282D', 11, 5),
  (5, 'L',  'Đen',   '#2E282D',  9, 6),
  -- 6. Áo sơ mi lụa tay dài
  (6, 'S', 'Kem',  '#F3E9DC', 5, 1),
  (6, 'M', 'Kem',  '#F3E9DC', 7, 2),
  (6, 'L', 'Kem',  '#F3E9DC', 3, 3),
  -- 7. Quần jean ống rộng
  (7, '26', 'Xanh nhạt', '#A8BFD6', 4, 1),
  (7, '27', 'Xanh nhạt', '#A8BFD6', 6, 2),
  (7, '28', 'Xanh nhạt', '#A8BFD6', 5, 3),
  (7, '29', 'Xanh nhạt', '#A8BFD6', 2, 4),
  -- 8. Chân váy xếp ly
  (8, 'S', 'Đen', '#2E282D', 6, 1),
  (8, 'M', 'Đen', '#2E282D', 8, 2),
  (8, 'L', 'Đen', '#2E282D', 4, 3),
  -- 9. Set áo quần linen
  (9, 'M', 'Be',        '#E8D8C3', 5, 1),
  (9, 'L', 'Be',        '#E8D8C3', 3, 2),
  (9, 'M', 'Xanh mint', '#BFE3DA', 4, 3),
  -- 10. Váy công chúa bé gái
  (10, '2-3T', 'Hồng pastel', '#F7C6D9', 8, 1),
  (10, '3-4T', 'Hồng pastel', '#F7C6D9', 6, 2),
  (10, '4-5T', 'Hồng pastel', '#F7C6D9', 5, 3),
  (10, '5-6T', 'Hồng pastel', '#F7C6D9', 2, 4),
  (10, '3-4T', 'Trắng',       '#FFFFFF', 4, 5),
  (10, '4-5T', 'Trắng',       '#FFFFFF', 3, 6),
  -- 11. Set đồ bé gái
  (11, '2-3T', 'Vàng', '#F6E1A6', 5, 1),
  (11, '3-4T', 'Vàng', '#F6E1A6', 7, 2),
  (11, '4-5T', 'Vàng', '#F6E1A6', 4, 3),
  (11, '5-6T', 'Vàng', '#F6E1A6', 1, 4),
  -- 12. Áo thun bé trai
  (12, '1-2T', 'Xanh mint', '#BFE3DA', 10, 1),
  (12, '2-3T', 'Xanh mint', '#BFE3DA', 12, 2),
  (12, '3-4T', 'Xanh mint', '#BFE3DA',  9, 3),
  (12, '5-6T', 'Xanh mint', '#BFE3DA',  6, 4),
  (12, '2-3T', 'Trắng',     '#FFFFFF',  8, 5),
  -- 13. Quần short kaki bé
  (13, '2-3T', 'Be', '#E8D8C3', 9, 1),
  (13, '3-4T', 'Be', '#E8D8C3', 7, 2),
  (13, '4-5T', 'Be', '#E8D8C3', 5, 3),
  -- 14. Mũ vành tròn
  (14, 'Freesize', 'Hồng pastel', '#F7C6D9', 12, 1),
  (14, 'Freesize', 'Kem',         '#F3E9DC',  9, 2);

-- ---------------------------------------------------------------------------
-- Ảnh minh hoạ (SVG dựng sẵn, nạp vào R2 bằng scripts/seed-images.mjs)
-- ---------------------------------------------------------------------------
INSERT INTO product_images (product_id, r2_key, sort_order) VALUES
  (1, 'demo/p1-a.svg', 0), (1, 'demo/p1-b.svg', 1),
  (2, 'demo/p2-a.svg', 0),
  (3, 'demo/p3-a.svg', 0),
  (4, 'demo/p4-a.svg', 0),
  (5, 'demo/p5-a.svg', 0),
  (6, 'demo/p6-a.svg', 0),
  (7, 'demo/p7-a.svg', 0),
  (8, 'demo/p8-a.svg', 0),
  (9, 'demo/p9-a.svg', 0),
  (10, 'demo/p10-a.svg', 0), (10, 'demo/p10-b.svg', 1),
  (11, 'demo/p11-a.svg', 0),
  (12, 'demo/p12-a.svg', 0),
  (13, 'demo/p13-a.svg', 0),
  (14, 'demo/p14-a.svg', 0);

-- ---------------------------------------------------------------------------
-- Mã giảm giá mẫu
-- ---------------------------------------------------------------------------
INSERT INTO discount_codes (code, description, discount_type, discount_value, max_discount, min_order, usage_limit) VALUES
  ('CHAOBAN', 'Giảm 10% cho khách mới', 'percent', 10, 50000, 200000, 100),
  ('FREESHIP', 'Giảm 30.000đ phí ship', 'amount', 30000, NULL, 150000, NULL);

-- ---------------------------------------------------------------------------
-- Đánh giá mẫu
-- ---------------------------------------------------------------------------
INSERT INTO product_reviews (product_id, author_name, rating, content) VALUES
  (1, 'Thu Hà',    5, 'Vải mềm, form chuẩn như hình. Shop gói hàng cẩn thận.'),
  (1, 'Minh Anh',  5, 'Mặc rất tôn dáng, sẽ ủng hộ shop tiếp.'),
  (1, 'Ngọc Lan',  4, 'Đẹp nhưng giao hơi lâu một chút.'),
  (5, 'Phương Vy', 5, 'Áo dày dặn, giặt không bai.'),
  (10, 'Mẹ Bống',  5, 'Bé nhà mình mặc thích lắm, vải mát.');
