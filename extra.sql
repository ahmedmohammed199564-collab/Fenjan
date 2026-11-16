-- =====================================================================
--  فنجان — قواعد الخصم التلقائية + مستندات الموظف
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

-- ---------- 1) قواعد الخصم التلقائية (أعمدة في الإعدادات) ----------
alter table public.settings add column if not exists auto_rules_on boolean not null default false;
alter table public.settings add column if not exists late_free   int     not null default 0;   -- مرات تأخير مسموحة بالشهر قبل الخصم
alter table public.settings add column if not exists late_fee    numeric not null default 0;   -- خصم لكل مرة تأخير بعد المسموح
alter table public.settings add column if not exists absent_fee  numeric not null default 0;   -- غرامة إضافية لكل يوم غياب

-- ---------- 2) مستندات الموظف ----------
create table if not exists public.employee_docs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null default '',
  path        text not null,
  uploaded_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.employee_docs enable row level security;
drop policy if exists ed_sel on public.employee_docs;
create policy ed_sel on public.employee_docs for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists ed_ins on public.employee_docs;
create policy ed_ins on public.employee_docs for insert to authenticated
  with check (public.is_staff());
drop policy if exists ed_del on public.employee_docs;
create policy ed_del on public.employee_docs for delete to authenticated
  using (public.is_staff());

-- تسجيل إضافة/حذف مستند في سجل العمليات
create or replace function public.fn_audit_docs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then perform public._audit('إضافة مستند', format('%s — %s', NEW.name, coalesce((select full_name from public.profiles where id = NEW.user_id), '')));
  elsif TG_OP = 'DELETE' then perform public._audit('حذف مستند', format('%s — %s', OLD.name, coalesce((select full_name from public.profiles where id = OLD.user_id), ''))); return OLD; end if;
  return NEW;
end $$;
drop trigger if exists fenjan_audit_docs on public.employee_docs;
create trigger fenjan_audit_docs after insert or delete on public.employee_docs
  for each row execute function public.fn_audit_docs();

-- ---------- 3) مساحة تخزين الملفات (bucket خاص) ----------
insert into storage.buckets (id, name, public) values ('docs', 'docs', false)
  on conflict (id) do nothing;

-- سياسات التخزين: الإدارة ترفع/تحذف، والموظف يشوف ملفاته بس
drop policy if exists docs_sel on storage.objects;
create policy docs_sel on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (public.is_staff() or split_part(name, '/', 1) = auth.uid()::text));
drop policy if exists docs_ins on storage.objects;
create policy docs_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and public.is_staff());
drop policy if exists docs_del on storage.objects;
create policy docs_del on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and public.is_staff());
