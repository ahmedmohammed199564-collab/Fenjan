-- =====================================================================
--  فنجان — موظفين باليومية + تأكيد قراءة الإعلانات + تنبيهات + نهاية الخدمة
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

-- 1) نوع الأجر: شهري أو يومي + سعر اليوم + تاريخ التعيين
alter table public.profiles add column if not exists pay_type   text    not null default 'monthly' check (pay_type in ('monthly','daily'));
alter table public.profiles add column if not exists daily_rate numeric not null default 0;
alter table public.profiles add column if not exists hire_date  date;

-- 2) حدود التنبيهات الذكية (في الإعدادات)
alter table public.settings add column if not exists alert_late   int not null default 3;
alter table public.settings add column if not exists alert_absent int not null default 3;

-- 3) تأكيد قراءة الإعلانات
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.announcement_reads enable row level security;
drop policy if exists ar_sel on public.announcement_reads;
create policy ar_sel on public.announcement_reads for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists ar_ins on public.announcement_reads;
create policy ar_ins on public.announcement_reads for insert to authenticated
  with check (user_id = auth.uid());
