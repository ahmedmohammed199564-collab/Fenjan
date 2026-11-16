-- =====================================================================
--  فنجان — الصلاحيات الدقيقة (Permissions)
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
--
--  الفكرة: صاحب المطعم (owner) عنده كل الصلاحيات دايمًا. الـ HR بياخد
--  صلاحيات محددة يحددها صاحب المطعم. الموظف العادي مالوش أي صلاحية إدارية.
--  الصلاحيات الأربعة:
--    can_payroll  : يشوف ويعدّل المرتبات وكشف المرتبات
--    can_money    : يضيف/يعدّل السلف والجزاءات
--    can_approve  : يوافق على الحسابات الجديدة
--    can_settings : يعدّل إعدادات المطعم (الموقع/الشيفتات/القواعد)
--  التغيير في الأدوار والصلاحيات = صاحب المطعم بس.
-- =====================================================================

-- 1) أعمدة الصلاحيات على جدول الموظفين (الافتراضي: مقفولة)
alter table public.profiles add column if not exists can_payroll  boolean not null default false;
alter table public.profiles add column if not exists can_money    boolean not null default false;
alter table public.profiles add column if not exists can_approve  boolean not null default false;
alter table public.profiles add column if not exists can_settings boolean not null default false;

-- 2) دالة تتأكد إن اللي بيعمل العملية عنده الصلاحية
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when pr.role = 'owner' then true
      when pr.role = 'hr' and pr.active then
        case p
          when 'payroll'  then pr.can_payroll
          when 'money'    then pr.can_money
          when 'approve'  then pr.can_approve
          when 'settings' then pr.can_settings
          else false
        end
      else false
    end
    from public.profiles pr where pr.id = auth.uid()
  ), false);
$$;
revoke execute on function public.has_perm(text) from public, anon;
grant  execute on function public.has_perm(text) to authenticated;

-- 3) حارس جدول الموظفين: يتحكم في تغيير الأدوار/الصلاحيات/المرتبات
--    نشيل أي تريجر قديم على profiles ونركّب حارس فنجان لوحده (آمن).
do $$
declare r record;
begin
  for r in
    select t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and not t.tgisinternal and t.tgname <> 'fenjan_guard_profiles'
  loop
    execute format('drop trigger if exists %I on public.profiles', r.tgname);
  end loop;
end $$;

create or replace function public.fn_guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
declare o boolean := public.is_owner();
begin
  -- حماية حساب صاحب المطعم من أي حد غيره
  if OLD.role = 'owner' and not o then
    raise exception 'لا يمكن تعديل حساب صاحب المطعم';
  end if;

  -- تغيير الدور
  if NEW.role is distinct from OLD.role then
    if o then
      null;  -- صاحب المطعم يعمل أي دور
    elsif public.has_perm('approve') and OLD.role = 'pending' and NEW.role = 'employee' then
      null;  -- HR معاه صلاحية الموافقة: يوافق على حساب جديد (موظف فقط)
    else
      raise exception 'لا تملك صلاحية تغيير الأدوار';
    end if;
    if NEW.role in ('hr','owner') and not o then
      raise exception 'صاحب المطعم فقط يقدر يعيّن HR أو مالك';
    end if;
  end if;

  -- تغيير الصلاحيات = صاحب المطعم بس
  if (NEW.can_payroll, NEW.can_money, NEW.can_approve, NEW.can_settings)
     is distinct from (OLD.can_payroll, OLD.can_money, OLD.can_approve, OLD.can_settings)
     and not o then
    raise exception 'صاحب المطعم فقط يقدر يغيّر الصلاحيات';
  end if;

  -- تعديل المرتب يحتاج صلاحية المرتبات
  if NEW.salary is distinct from OLD.salary and not (o or public.has_perm('payroll')) then
    raise exception 'لا تملك صلاحية تعديل المرتبات';
  end if;

  return NEW;
end $$;

create trigger fenjan_guard_profiles
  before update on public.profiles
  for each row execute function public.fn_guard_profiles();

-- 4) حارس عام يطلب صلاحية معيّنة قبل الكتابة (للسلف/الجزاءات/الإعدادات)
create or replace function public.fn_require_perm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm(TG_ARGV[0]) then
    raise exception 'مالكش صلاحية للعملية دي';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

drop trigger if exists fenjan_perm_settings on public.settings;
create trigger fenjan_perm_settings
  before update on public.settings
  for each row execute function public.fn_require_perm('settings');

drop trigger if exists fenjan_perm_adv on public.advances;
create trigger fenjan_perm_adv
  before insert or update or delete on public.advances
  for each row execute function public.fn_require_perm('money');

drop trigger if exists fenjan_perm_pen on public.penalties;
create trigger fenjan_perm_pen
  before insert or update or delete on public.penalties
  for each row execute function public.fn_require_perm('money');

-- تم. أي حساب HR موجود دلوقتي صلاحياته مقفولة لحد ما صاحب المطعم يفعّلها.
