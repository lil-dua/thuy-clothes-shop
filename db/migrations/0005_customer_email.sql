-- ============================================================================
-- Migration 0005: email khách hàng
--
-- Muốn gửi xác nhận đơn thì phải có chỗ chứa địa chỉ email. Cột để NULL được
-- vì email là tuỳ chọn — khách Việt đặt hàng qua Threads phần lớn chỉ để lại
-- số điện thoại, bắt nhập email là mất đơn.
-- ============================================================================

ALTER TABLE orders ADD COLUMN customer_email TEXT;
ALTER TABLE customers ADD COLUMN email TEXT;
