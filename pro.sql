-- =====================================================================
--  فنجان — إضافات احترافية:
--  جدول الشيفتات + البدلات/الحوافز + قفل الشهر + سجل العمليات
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

-- سعر ساعة الأوفر تايم (0 = مقفول)
alter table public.settings add column if not exists ot_rate numeric not null default 0;

-- ---------- 1) جدول الشيفتات المخطط ----------
create table if not exists public.shift_schedule (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  shift     text not null check (shift in ('M','E','off')),
  primary key (user_id, work_date)
);
alter table public.shift_schedule enable row level security;
drop policy if exists ss_sel on public.shift_schedule;
create policy ss_sel on public.shift_schedule for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists ss_all on public.shift_schedule;
create policy ss_all on public.shift_schedule for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- 2) البدلات والحوافز (إضافات موجبة على المرتب) ----------
create table if not exists public.adjustments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null,
  kind       text not null default 'allowance' check (kind in ('allowance','bonus')),
  amount     numeric not null default 0,
  note       text default '',
  created_at timestamptz not null default now()
);
alter table public.adjustments enable row level security;
drop policy if exists aj_sel on public.adjustments;
create policy aj_sel on public.adjustments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists aj_all on public.adjustments;
create policy aj_all on public.adjustments for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- صلاحية «السلف والجزاءات» مطلوبة للكتابة على البدلات كمان
drop trigger if exists fenjan_perm_adj on public.adjustments;
create trigger fenjan_perm_adj
  before insert or update or delete on public.adjustments
  for each row execute function public.fn_require_perm('money');

-- ---------- 3) قفل الشهر (لقطة أرقام) ----------
create table if not exists public.month_close (
  month        text primary key,
  net_total    numeric,
  salary_total numeric,
  ded_total    numeric,
  headcount    int,
  snapshot     jsonb,
  closed_by    uuid references public.profiles(id),
  closed_at    timestamptz not null default now()
);
alter table public.month_close enable row level security;
drop policy if exists mc_sel on public.month_close;
create policy mc_sel on public.month_close for select to authenticated
  using (public.is_staff());
drop policy if exists mc_all on public.month_close;
create policy mc_all on public.month_close for all to authenticated
  using (public.is_owner() or public.has_perm('payroll'))
  with check (public.is_owner() or public.has_perm('payroll'));

-- ---------- 4) سجل العمليات ----------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  actor_name text,
  action     text,
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
drop policy if exists al_sel on public.audit_log;
create policy al_sel on public.audit_log for select to authenticated
  using (public.is_staff());
drop policy if exists al_ins on public.audit_log;
create policy al_ins on public.audit_log for insert to authenticated
  with check (actor = auth.uid());

create or replace function public._audit(act text, det text) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, actor_name, action, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), act, det);
$$;
revoke execute on function public._audit(text, text) from public, anon;
grant  execute on function public._audit(text, text) to authenticated;

-- تسجيل تغييرات الموظفين
create or replace function public.fn_audit_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.role is distinct from OLD.role then perform public._audit('تغيير دور', format('%s: %s ← %s', NEW.full_name, OLD.role, NEW.role)); end if;
  if NEW.salary is distinct from OLD.salary then perform public._audit('تعديل مرتب', format('%s: %s ← %s', NEW.full_name, OLD.salary, NEW.salary)); end if;
  if NEW.active is distinct from OLD.active then perform public._audit('حالة موظف', format('%s: %s', NEW.full_name, case when NEW.active then 'تفعيل' else 'إيقاف' end)); end if;
  if (NEW.can_payroll,NEW.can_money,NEW.can_approve,NEW.can_settings) is distinct from (OLD.can_payroll,OLD.can_money,OLD.can_approve,OLD.can_settings)
     then perform public._audit('تغيير صلاحيات', NEW.full_name); end if;
  return NEW;
end $$;
drop trigger if exists fenjan_audit_profiles on public.profiles;
create trigger fenjan_audit_profiles after update on public.profiles
  for each row execute function public.fn_audit_profiles();

-- تسجيل السلف/الجزاءات/البدلات
create or replace function public.fn_audit_money() returns trigger
language plpgsql security definer set search_path = public as $$
declare lbl text := TG_ARGV[0]; amt numeric; uid uuid;
begin
  if TG_OP = 'DELETE' then amt := OLD.amount; uid := OLD.user_id;
    perform public._audit('حذف ' || lbl, format('%s ج — %s', amt, coalesce((select full_name from public.profiles where id = uid), '')));
    return OLD;
  else amt := NEW.amount; uid := NEW.user_id;
    perform public._audit((case when TG_OP='INSERT' then 'إضافة ' else 'تعديل ' end) || lbl, format('%s ج — %s', amt, coalesce((select full_name from public.profiles where id = uid), '')));
    return NEW;
  end if;
end $$;
drop trigger if exists fenjan_audit_adv on public.advances;
create trigger fenjan_audit_adv after insert or update or delete on public.advances
  for each row execute function public.fn_audit_money('سلفة');
drop trigger if exists fenjan_audit_pen on public.penalties;
create trigger fenjan_audit_pen after insert or update or delete on public.penalties
  for each row execute function public.fn_audit_money('جزاء');
drop trigger if exists fenjan_audit_adj on public.adjustments;
create trigger fenjan_audit_adj after insert or update or delete on public.adjustments
  for each row execute function public.fn_audit_money('بدل/حافز');

-- منع الكتابة على شهر مقفول (السلف/الجزاءات/البدلات)
create or replace function public.fn_block_closed() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(NEW.entry_date, OLD.entry_date);
begin
  if exists (select 1 from public.month_close where month = to_char(d, 'YYYY-MM')) then
    raise exception 'الشهر ده مقفول، مينفعش تعديل.';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if; return NEW;
end $$;
drop trigger if exists fenjan_lock_adv on public.advances;
create trigger fenjan_lock_adv before insert or update or delete on public.advances
  for each row execute function public.fn_block_closed();
drop trigger if exists fenjan_lock_pen on public.penalties;
create trigger fenjan_lock_pen before insert or update or delete on public.penalties
  for each row execute function public.fn_block_closed();
drop trigger if exists fenjan_lock_adj on public.adjustments;
create trigger fenjan_lock_adj before insert or update or delete on public.adjustments
  for each row execute function public.fn_block_closed();

-- تسجيل قفل/فتح الشهر
create or replace function public.fn_audit_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then perform public._audit('قفل الشهر', NEW.month);
  elsif TG_OP = 'DELETE' then perform public._audit('فتح الشهر', OLD.month); return OLD; end if;
  return NEW;
end $$;
drop trigger if exists fenjan_audit_close on public.month_close;
create trigger fenjan_audit_close after insert or delete on public.month_close
  for each row execute function public.fn_audit_close();

-- تسجيل قرار الإجازة داخل دالة الموافقة
create or replace function public.decide_leave(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare lr public.leave_requests; d date;
begin
  if not public.is_staff() then raise exception 'مالكش صلاحية'; end if;
  if p_status not in ('approved','rejected') then raise exception 'حالة غير صحيحة'; end if;
  update public.leave_requests set status = p_status, decided_by = auth.uid(), decided_at = now()
   where id = p_id returning * into lr;
  if not found then raise exception 'الطلب مش موجود'; end if;
  perform public._audit(case when p_status='approved' then 'موافقة إجازة' else 'رفض إجازة' end,
    format('%s (%s ← %s)', coalesce((select full_name from public.profiles where id = lr.user_id), ''), lr.start_date, lr.end_date));
  if p_status = 'approved' and lr.kind in ('leave','sick') then
    d := lr.start_date;
    while d <= lr.end_date loop
      insert into public.attendance (user_id, work_date, status, manual, late_min)
      values (lr.user_id, d, 'off', true, 0) on conflict (user_id, work_date) do nothing;
      d := d + 1;
    end loop;
  end if;
end $$;
revoke execute on function public.decide_leave(uuid, text) from public, anon;
grant  execute on function public.decide_leave(uuid, text) to authenticated;
