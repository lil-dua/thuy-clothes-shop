-- ============================================================================
-- Migration 0004: hoàn thiện đánh giá sản phẩm + chuẩn bị gửi email
--
-- Bảng product_reviews đã có từ 0001 nhưng chỉ dùng để ĐỌC. Nay khách mua hàng
-- tự gửi đánh giá được, nên cần thêm ràng buộc chống gửi trùng.
-- ============================================================================

-- Mỗi đơn chỉ đánh giá một sản phẩm một lần. Không có ràng buộc này thì bấm
-- gửi hai lần là có hai đánh giá giống hệt nhau.
--
-- Cố ý KHÔNG dùng partial index (WHERE order_id IS NOT NULL): SQLite bắt mệnh
-- đề ON CONFLICT phải khớp index kể cả phần WHERE, nếu không sẽ báo "ON CONFLICT
-- clause does not match any PRIMARY KEY or UNIQUE constraint". Index thường vẫn
-- đúng ý vì SQLite coi mỗi NULL là một giá trị khác nhau, nên các đánh giá cũ
-- không gắn đơn (order_id NULL) không chặn lẫn nhau.
CREATE UNIQUE INDEX idx_reviews_order_product
  ON product_reviews(order_id, product_id);

-- Sắp xếp theo thời gian ở trang duyệt đánh giá của admin
CREATE INDEX idx_reviews_created ON product_reviews(created_at DESC);

-- ----------------------------------------------------------------------------
-- Nhật ký email đã gửi.
--
-- Giữ lại để biết đơn nào đã báo cho khách, đơn nào chưa — và để không gửi
-- trùng khi thao tác lặp lại. Lỗi gửi cũng ghi vào đây kèm nguyên nhân, vì
-- email hỏng là loại lỗi rất dễ trôi qua mà không ai biết.
-- ----------------------------------------------------------------------------
CREATE TABLE email_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('order_customer', 'order_owner')),
  recipient  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_email_log_order ON email_log(order_id, kind);
