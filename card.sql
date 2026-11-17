-- =====================================================================
--  فنجان — تسجيل صورة البطاقة إلزامي للموظف
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

-- مسار صورة البطاقة على ملف الموظف (لو فاضي يبقى لسه مرفعش)
alter table public.profiles add column if not exists id_card text;

-- الموظف يسجّل مسار بطاقته بنفسه (لنفسه بس)
create or replace function public.set_my_id_card(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set id_card = p_path where id = auth.uid();
end $$;
revoke execute on function public.set_my_id_card(text) from public, anon;
grant  execute on function public.set_my_id_card(text) to authenticated;

-- اسمح للموظف يرفع ملفاته في مجلده الخاص (وكمان الإدارة)
drop policy if exists docs_ins on storage.objects;
create policy docs_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (public.is_staff() or split_part(name, '/', 1) = auth.uid()::text));

-- اسمح للموظف يضيف مستند لنفسه (عشان صورة البطاقة تظهر في مستنداته)
drop policy if exists ed_ins on public.employee_docs;
create policy ed_ins on public.employee_docs for insert to authenticated
  with check (public.is_staff() or user_id = auth.uid());
