-- ============================================================================
-- Migration 0007: giới hạn tần suất (rate limiting)
--
-- Đếm số lần thử trong một cửa sổ thời gian cố định (fixed window) cho một
-- cặp (scope, identifier) — ví dụ scope='admin-login', identifier=IP. Bảng
-- nhỏ, tự dọn bản ghi của cửa sổ trước đó ngay trong app/lib/rate-limit.server.ts
-- nên không cần thêm cron riêng.
-- ============================================================================

CREATE TABLE rate_limits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (scope, identifier, window_start)
);

CREATE INDEX idx_rate_limits_lookup ON rate_limits(scope, identifier, window_start);
