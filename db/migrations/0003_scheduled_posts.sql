-- ============================================================================
-- Migration 0003: hẹn giờ đăng bài
--
-- Thêm `scheduled_at` và mở rộng tập trạng thái. SQLite không sửa được ràng
-- buộc CHECK tại chỗ, nên phải dựng bảng mới rồi chuyển dữ liệu sang.
--
-- Đổi tên trạng thái: 'publishing' trước đây mang nghĩa "đã lưu nháp trên
-- Typefully" — tên gây hiểu nhầm, nay tách thành 'draft' và 'scheduled'.
-- ============================================================================

CREATE TABLE social_posts_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER REFERENCES products(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL DEFAULT 'threads',
  draft_id      TEXT,
  status        TEXT NOT NULL CHECK (status IN (
                  'draft',       -- nằm ở mục nháp trên Typefully, chưa hẹn giờ
                  'scheduled',   -- đã hẹn giờ, Typefully sẽ tự đăng
                  'publishing',  -- Typefully đang đăng
                  'published',   -- đã lên sóng
                  'failed',      -- gọi API hỏng hoặc Typefully báo lỗi
                  'cancelled'    -- chủ shop huỷ trước giờ đăng
                )),
  caption       TEXT NOT NULL,
  media_count   INTEGER NOT NULL DEFAULT 0,
  -- Thời điểm Typefully sẽ đăng, lưu UTC như mọi cột thời gian khác
  scheduled_at  TEXT,
  published_url TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO social_posts_new
  (id, product_id, platform, draft_id, status, caption, media_count,
   published_url, error, created_at, updated_at)
SELECT
  id, product_id, platform, draft_id,
  CASE status WHEN 'publishing' THEN 'draft' ELSE status END,
  caption, media_count, published_url, error, created_at, updated_at
FROM social_posts;

DROP TABLE social_posts;
ALTER TABLE social_posts_new RENAME TO social_posts;

CREATE INDEX idx_social_posts_product   ON social_posts(product_id, created_at DESC);
CREATE INDEX idx_social_posts_status    ON social_posts(status);
-- Cron quét các bài đã tới giờ nên cần index theo mốc hẹn
CREATE INDEX idx_social_posts_scheduled ON social_posts(scheduled_at)
  WHERE status = 'scheduled';
