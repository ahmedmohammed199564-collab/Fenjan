-- =====================================================================
--  Attenda HR — الشغل مع الأعداد الكبيرة (مئات / آلاف الموظفين)
--  الصق الملف كله في Supabase > SQL Editor ودوس Run. آمن وممكن يتشغّل أكتر من مرة.
--
--  بيضيف:
--   1) month_summary : ملخص حضور الشهر لكل موظف (أيام، غياب، تأخير، ساعات) محسوب
--      جوه قاعدة البيانات، فالتطبيق مش محتاج ينزّل ٣٠ ألف سجل حضور في كل فتح.
--      منطق الساعات نفس منطق التطبيق بالظبط (الشيفت بيتقفل تلقائي عند عدد ساعات الشيفت).
--   2) ann_read_counts : عدد اللي قرأوا كل إعلان.
--   3) فهارس بالتاريخ علشان الاستعلامات تفضل سريعة لما الجدول يكبر.
--  التطبيق بيستخدمهم تلقائي بس لما عدد الموظفين يعدّي ١٥٠، ولو الملف ده ماتشغّلش
--  بيكمّل بالطريقة العادية من غير أي مشكلة.
-- =====================================================================

create index if not exists attendance_work_date_idx    on public.attendance (work_date, user_id);
create index if not exists shift_schedule_work_date_idx on public.shift_schedule (work_date, user_id);

create or replace function public.month_summary(p_month date, p_today date)
returns json
language plpgsql
stable
security invoker            -- بيحترم صلاحيات الجداول (RLS) زي أي استعلام عادي
set search_path = public
as $$
declare
  sh   numeric;
  d1   date := date_trunc('month', p_month)::date;
  d2   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  res  json;
begin
  select nullif(shift_hours, 0) into sh from public.settings where id = 1;
  sh := coalesce(sh, 9);

  with a as (
    select user_id, work_date, status, shift, late_min,
      case
        when status <> 'present' then 0
        when check_in is not null and check_out is not null
          then least(sh, greatest(0, extract(epoch from (check_out - check_in)) / 3600.0))
        when check_in is not null
          then case when work_date < p_today then sh
                    else least(sh, greatest(0, extract(epoch from (now() - check_in)) / 3600.0)) end
        when coalesce(manual, false) then sh
        else 0
      end as hrs
    from public.attendance
    where work_date between d1 and d2
  ),
  u as (
    select user_id,
      count(*) filter (where status = 'present')                    as w,
      count(*) filter (where status = 'present' and shift = 'M')    as m,
      count(*) filter (where status = 'present' and shift = 'E')    as e,
      count(*) filter (where status = 'off')                        as o,
      count(*) filter (where status = 'absent')                     as ab,
      round(sum(hrs)::numeric, 4)                                   as h,
      count(*) filter (where status = 'present' and late_min > 0)   as l,
      coalesce(sum(late_min) filter (where status = 'present' and late_min > 0), 0) as lm
    from a group by user_id
  ),
  d as (
    select work_date, count(*) as c from a where status = 'present' group by work_date
  )
  select json_build_object(
    'users',  coalesce((select json_agg(json_build_object('u', user_id, 'w', w, 'm', m, 'e', e, 'o', o, 'a', ab, 'h', h, 'l', l, 'lm', lm)) from u), '[]'::json),
    'by_day', coalesce((select json_object_agg(work_date::text, c) from d), '{}'::json)
  ) into res;

  return res;
end $$;

create or replace function public.ann_read_counts()
returns table (announcement_id bigint, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select announcement_id, count(distinct user_id) from public.announcement_reads group by announcement_id;
$$;

revoke execute on function public.month_summary(date, date) from public, anon;
revoke execute on function public.ann_read_counts() from public, anon;
grant  execute on function public.month_summary(date, date) to authenticated;
grant  execute on function public.ann_read_counts() to authenticated;
