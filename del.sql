-- =====================================================================
--  فنجان — إضافة: حذف موظف نهائيًا
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن وممكن يتشغّل أكتر من مرة.
--
--  الدالة دي صاحب المطعم بس اللي يقدر ينفّذها. بتمسح ملف الموظف
--  (وكل بياناته المرتبطة بتتمسح تلقائيًا بسبب on delete cascade)
--  وكمان بتمسح حساب الدخول بتاعه علشان ميقدرش يرجع لوحده.
-- =====================================================================

create or replace function public.delete_employee(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare nm text;
begin
  if not public.is_owner() then
    raise exception 'مش مسموح: صاحب المطعم بس اللي يقدر يحذف موظف';
  end if;
  if p_id = auth.uid() then
    raise exception 'مينفعش تحذف حسابك إنت';
  end if;
  if not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'الموظف ده مش موجود';
  end if;
  if exists (select 1 from public.profiles where id = p_id and role = 'owner') then
    raise exception 'مينفعش تحذف صاحب المطعم';
  end if;

  select full_name into nm from public.profiles where id = p_id;
  perform public._audit('حذف موظف', coalesce(nm, ''));

  -- مسح الملف (كل البيانات المرتبطة بتتمسح تلقائيًا عن طريق on delete cascade)
  delete from public.profiles where id = p_id;

  -- مسح حساب الدخول نفسه
  delete from auth.users where id = p_id;
end $$;

revoke execute on function public.delete_employee(uuid) from public, anon;
grant execute on function public.delete_employee(uuid) to authenticated;
