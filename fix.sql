-- =====================================================================
--  فنجان — إصلاح: ضمان إنشاء ملف موظف لكل حساب
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن وممكن يتشغّل أكتر من مرة.
-- =====================================================================

-- 1) دالة تبني ملف الموظف من الحساب الجديد
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, full_name, phone, role)
  values (new.id,
          left(coalesce(new.raw_user_meta_data->>'full_name', ''), 80),
          left(coalesce(new.raw_user_meta_data->>'phone', ''), 20),
          case when first_user then 'owner' else 'pending' end)
  on conflict (id) do nothing;
  return new;
end $$;

-- 2) إعادة تركيب التريجر علشان أي حساب جديد ياخد ملف تلقائي
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) شبكة أمان: التطبيق بينادي الدالة دي لو الملف مكانش اتعمل
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); first_user boolean; meta jsonb;
begin
  if uid is null then return; end if;
  if exists (select 1 from profiles where id = uid) then return; end if;
  select not exists (select 1 from profiles) into first_user;
  select raw_user_meta_data into meta from auth.users where id = uid;
  insert into profiles (id, full_name, phone, role)
  values (uid,
          left(coalesce(meta->>'full_name', ''), 80),
          left(coalesce(meta->>'phone', ''), 20),
          case when first_user then 'owner' else 'pending' end)
  on conflict (id) do nothing;
end $$;

revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;
