-- =====================================================================
--  فنجان — جدولة الملخص اليومي (اختياري، للإرسال التلقائي كل يوم)
--  محتاج: تفعّل إضافتي pg_cron و pg_net من Database > Extensions الأول.
--  وتكون نشرت دالة daily-summary وحطيت السر CRON_SECRET في Secrets.
--  غيّر <CRON_SECRET> تحت لنفس القيمة اللي حطيتها في Secrets.
-- =====================================================================

-- بيشغّل الملخص كل يوم الساعة 11:30 بالليل بتوقيت القاهرة (= 21:30 UTC)
select cron.schedule(
  'fenjan-daily-summary',
  '30 21 * * *',
  $$
    select net.http_post(
      url     := 'https://ihrmsbbyxgvbwtgyzpnf.supabase.co/functions/v1/daily-summary',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $$
);

-- لإلغاء الجدولة لاحقًا:
-- select cron.unschedule('fenjan-daily-summary');
