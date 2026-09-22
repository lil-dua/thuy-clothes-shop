-- ============================================================================
-- Migration 0002: nhật ký bài đăng mạng xã hội (Giai đoạn 3 của kế hoạch)
--
-- Ghi lại mỗi lần đăng sản phẩm lên Threads qua Typefully, để:
--   • chủ shop thấy sản phẩm nào đã đăng, đăng lúc nào, link bài ra sao
--   • không đăng trùng một sản phẩm hai lần mà không hay biết
--   • lần đăng lỗi vẫn còn dấu vết kèm thông báo lỗi để thử lại
-- ============================================================================

CREATE TABLE social_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER REFERENCES products(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL DEFAULT 'threads',
  -- id bản nháp bên Typefully, dùng để tra lại trạng thái đăng
  draft_id      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('publishing', 'published', 'failed')),
  caption       TEXT NOT NULL,
  -- số ảnh đính kèm thành công (Threads nhận nhiều ảnh trong một bài)
  media_count   INTEGER NOT NULL DEFAULT 0,
  published_url TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_social_posts_product ON social_posts(product_id, created_at DESC);
CREATE INDEX idx_social_posts_status  ON social_posts(status);
