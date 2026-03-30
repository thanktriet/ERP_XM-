-- ============================================================
-- Cron Jobs — ERP Xe Máy Điện
-- Migration: 20260330000099_cron_jobs
--
-- ⚠️  CHẠY FILE NÀY RIÊNG BIỆT, sau khi đã:
--   1. Vào Supabase Dashboard → Database → Extensions
--   2. Tìm "pg_cron" → bật ON
--   3. Tìm "pg_net"  → bật ON  (dùng để gọi HTTP)
--   4. Quay lại SQL Editor, dán và chạy toàn bộ file này
--
-- Kiểm tra jobs đã tạo:
--   SELECT * FROM cron.job;
-- ============================================================

-- Xóa job cũ nếu có (idempotent)
SELECT cron.unschedule('amis-sync-daily')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'amis-sync-daily');
SELECT cron.unschedule('close-day-daily')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-day-daily');

-- amis-sync: chạy lúc 23:00 ICT = 16:00 UTC
SELECT cron.schedule(
  'amis-sync-daily',
  '0 16 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/amis-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- close-day: chạy lúc 23:30 ICT = 16:30 UTC
SELECT cron.schedule(
  'close-day-daily',
  '30 16 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/close-day',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- Xác nhận
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
