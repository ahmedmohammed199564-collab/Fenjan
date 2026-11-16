-- =====================================================================
--  فنجان — إضافة: إشعارات الموبايل (Push)
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن وممكن يتشغّل أكتر من مرة.
-- =====================================================================
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  sub        jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_sel on public.push_subscriptions;
drop policy if exists push_ins on public.push_subscriptions;
drop policy if exists push_upd on public.push_subscriptions;
drop policy if exists push_del on public.push_subscriptions;

create policy push_sel on public.push_subscriptions for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy push_ins on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_upd on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_del on public.push_subscriptions for delete to authenticated using (user_id = auth.uid() or public.is_staff());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
