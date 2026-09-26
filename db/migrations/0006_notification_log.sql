-- ============================================================================
-- Migration 0006: nhật ký thông báo dùng chung cho nhiều kênh
--
-- email_log ở 0004 khoá cứng `kind` vào hai giá trị email. Nay có thêm
-- Telegram, và SQLite không sửa được ràng buộc CHECK tại chỗ nên phải dựng
-- bảng mới rồi chuyển dữ liệu sang.
--
-- Đổi luôn tên thành notification_log cho đúng nghĩa, và tách `channel` ra khỏi
-- `kind`: thêm Zalo ZNS hay SMS sau này chỉ là thêm một giá trị channel.
-- ============================================================================

CREATE TABLE notification_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  -- Gửi cho ai: khách hàng hay chủ shop
  audience   TEXT NOT NULL CHECK (audience IN ('customer', 'owner')),
  recipient  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO notification_log (order_id, channel, audience, recipient, status, error, created_at)
SELECT order_id, 'email',
       CASE kind WHEN 'order_owner' THEN 'owner' ELSE 'customer' END,
       recipient, status, error, created_at
FROM email_log;

DROP TABLE email_log;

CREATE INDEX idx_notification_order ON notification_log(order_id, channel);
CREATE INDEX idx_notification_status ON notification_log(status, created_at DESC);
