-- =====================================================================
--  فنجان — تقييم/إنذارات + طلب سلفة من الموظف + تأكيد صرف المرتب
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن ويتشغّل أكتر من مرة.
-- =====================================================================

-- 1) ملاحظات وإنذارات الأداء
create table if not exists public.staff_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'note' check (kind in ('warning','note','praise')),
  body       text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.staff_notes enable row level security;
drop policy if exists sn_sel on public.staff_notes;
create policy sn_sel on public.staff_notes for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists sn_ins on public.staff_notes;
create policy sn_ins on public.staff_notes for insert to authenticated
  with check (public.is_staff());
drop policy if exists sn_del on public.staff_notes;
create policy sn_del on public.staff_notes for delete to authenticated
  using (public.is_staff());

-- 2) طلبات السلف من الموظف
create table if not exists public.advance_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     numeric not null default 0,
  reason     text default '',
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.advance_requests enable row level security;
drop policy if exists areq_sel on public.advance_requests;
create policy areq_sel on public.advance_requests for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists areq_ins on public.advance_requests;
create policy areq_ins on public.advance_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
drop policy if exists areq_del on public.advance_requests;
create policy areq_del on public.advance_requests for delete to authenticated
  using (public.is_staff() or (user_id = auth.uid() and status = 'pending'));
drop policy if exists areq_upd on public.advance_requests;
create policy areq_upd on public.advance_requests for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- الموافقة بتسجّل سلفة فعلية (محتاجة صلاحية السلف والجزاءات)
create or replace function public.decide_advance_request(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare rq public.advance_requests;
begin
  if not public.is_staff() then raise exception 'مالكش صلاحية'; end if;
  if p_status not in ('approved','rejected') then raise exception 'حالة غير صحيحة'; end if;
  update public.advance_requests set status = p_status, decided_by = auth.uid(), decided_at = now()
   where id = p_id returning * into rq;
  if not found then raise exception 'الطلب مش موجود'; end if;
  if p_status = 'approved' then
    -- بيضيف سلفة فعلية (التريجر بتاع الصلاحيات هيتأكد من can_money)
    insert into public.advances (user_id, entry_date, amount, repaid, note)
    values (rq.user_id, current_date, rq.amount, 0, 'طلب سلفة متوافق عليه');
  end if;
  perform public._audit(
    case when p_status='approved' then 'موافقة طلب سلفة' else 'رفض طلب سلفة' end,
    format('%s — %s ج', coalesce((select full_name from public.profiles where id = rq.user_id), ''), rq.amount));
end $$;
revoke execute on function public.decide_advance_request(uuid, text) from public, anon;
grant  execute on function public.decide_advance_request(uuid, text) to authenticated;

-- 3) تأكيد صرف المرتب
create table if not exists public.salary_payments (
  month   text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount  numeric,
  paid_by uuid references public.profiles(id),
  paid_at timestamptz not null default now(),
  primary key (month, user_id)
);
alter table public.salary_payments enable row level security;
drop policy if exists sp_sel on public.salary_payments;
create policy sp_sel on public.salary_payments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists sp_all on public.salary_payments;
create policy sp_all on public.salary_payments for all to authenticated
  using (public.is_owner() or public.has_perm('payroll'))
  with check (public.is_owner() or public.has_perm('payroll'));
