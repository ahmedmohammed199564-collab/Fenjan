-- =====================================================================
--  فنجان — شيفت 9 ساعات + طلبات الأوفر تايم (موافقة المدير)
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

-- طول الشيفت بالساعات (الساعات بتتحسب بحد أقصى الرقم ده لكل يوم)
alter table public.settings add column if not exists shift_hours numeric not null default 9;

-- طلبات الأوفر تايم
create table if not exists public.overtime_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  work_date  date not null,
  hours      numeric not null default 0,
  reason     text default '',
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.overtime_requests enable row level security;

drop policy if exists ot_sel on public.overtime_requests;
create policy ot_sel on public.overtime_requests for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

drop policy if exists ot_ins on public.overtime_requests;
create policy ot_ins on public.overtime_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists ot_del on public.overtime_requests;
create policy ot_del on public.overtime_requests for delete to authenticated
  using (public.is_staff() or (user_id = auth.uid() and status = 'pending'));

drop policy if exists ot_upd on public.overtime_requests;
create policy ot_upd on public.overtime_requests for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- المدير يوافق/يرفض
create or replace function public.decide_overtime(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.overtime_requests;
begin
  if not public.is_staff() then raise exception 'مالكش صلاحية'; end if;
  if p_status not in ('approved','rejected') then raise exception 'حالة غير صحيحة'; end if;
  update public.overtime_requests
     set status = p_status, decided_by = auth.uid(), decided_at = now()
   where id = p_id returning * into o;
  if not found then raise exception 'الطلب مش موجود'; end if;
  perform public._audit(
    case when p_status='approved' then 'موافقة أوفر تايم' else 'رفض أوفر تايم' end,
    format('%s — %s ساعة يوم %s', coalesce((select full_name from public.profiles where id = o.user_id), ''), o.hours, o.work_date));
end $$;
revoke execute on function public.decide_overtime(uuid, text) from public, anon;
grant  execute on function public.decide_overtime(uuid, text) to authenticated;
