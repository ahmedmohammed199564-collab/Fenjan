-- =====================================================================
--  فنجان — نظام الإجازات والطلبات
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

create table if not exists public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'leave' check (kind in ('leave','sick','absence')),
  start_date  date not null,
  end_date    date not null,
  reason      text default '',
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by  uuid references public.profiles(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.leave_requests enable row level security;

-- الموظف يشوف طلباته، والإدارة تشوف الكل
drop policy if exists lr_sel on public.leave_requests;
create policy lr_sel on public.leave_requests for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- الموظف يقدّم طلب لنفسه فقط (حالته pending)
drop policy if exists lr_ins on public.leave_requests;
create policy lr_ins on public.leave_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- حذف: الإدارة، أو الموظف لو الطلب لسه pending
drop policy if exists lr_del on public.leave_requests;
create policy lr_del on public.leave_requests for delete to authenticated
  using (public.is_staff() or (user_id = auth.uid() and status = 'pending'));

-- تعديل مباشر: الإدارة فقط (الموافقة بتتم عن طريق الدالة تحت)
drop policy if exists lr_upd on public.leave_requests;
create policy lr_upd on public.leave_requests for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- دالة الموافقة/الرفض: الإدارة فقط. الموافقة بتسجّل الأيام «إجازة» في الحضور
create or replace function public.decide_leave(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare lr public.leave_requests; d date;
begin
  if not public.is_staff() then raise exception 'مالكش صلاحية'; end if;
  if p_status not in ('approved','rejected') then raise exception 'حالة غير صحيحة'; end if;
  update public.leave_requests
     set status = p_status, decided_by = auth.uid(), decided_at = now()
   where id = p_id returning * into lr;
  if not found then raise exception 'الطلب مش موجود'; end if;

  if p_status = 'approved' and lr.kind in ('leave','sick') then
    d := lr.start_date;
    while d <= lr.end_date loop
      insert into public.attendance (user_id, work_date, status, manual, late_min)
      values (lr.user_id, d, 'off', true, 0)
      on conflict (user_id, work_date) do nothing;
      d := d + 1;
    end loop;
  end if;
end $$;
revoke execute on function public.decide_leave(uuid, text) from public, anon;
grant  execute on function public.decide_leave(uuid, text) to authenticated;
