-- =====================================================================
--  فنجان — إضافة: إعلانات لكل الموظفين
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن وممكن يتشغّل أكتر من مرة.
-- =====================================================================
create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  body       text not null,
  author     text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;

drop policy if exists ann_read   on public.announcements;
drop policy if exists ann_insert on public.announcements;
drop policy if exists ann_delete on public.announcements;

-- أي موظف مسجّل يشوف الإعلانات؛ الإدارة والـ HR بس يكتبوا ويمسحوا
create policy ann_read   on public.announcements for select to authenticated using (true);
create policy ann_insert on public.announcements for insert to authenticated with check (public.is_staff());
create policy ann_delete on public.announcements for delete to authenticated using (public.is_staff());

grant select, insert, delete on public.announcements to authenticated;
