-- 97: 過去の記録（ジョブカン）の書庫
--
-- 【何のための表か】
--   ジョブカンで記録していた過去の勤怠を、Brown Work の画面で見られるようにします。
--   いまの勤怠データ（attendance_records）とは別の表に入れます。
--
-- 【なぜ別の表にするのか】
--   1. 当時の数字をそのまま見せるため。
--      Brown Work はいまの設定で残業を計算し直すため、同じ表に入れると
--      当時の給与明細と食い違います。別の表なら、ジョブカンが出した数字を
--      そのまま出せます。
--   2. 源泉徴収票・給与計算・月次確定に混ざらないため。
--      これらの処理はこの表を一切見ません。過去分で誤って明細を作る事故が
--      起きません。
--   3. 有休の残日数に影響しないため。
--
-- 【見られる人】
--   本人・管理者・マスター管理者。書き込めるのはマスター管理者だけです。
--
-- 【何度流しても同じ結果になります】

-- ---- 1. 月ごとのまとめ ----
create table if not exists public.legacy_attendance_months (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),

  -- 取り込んだファイルにあった値（突き合わせの記録として残します）
  source_staff_name text,
  source_staff_number text,
  source_group_path text,
  source_staff_type text,

  -- 出勤日数など
  work_days numeric,
  weekday_days numeric,
  holiday_days numeric,
  absent_days numeric,
  late_count numeric,
  early_count numeric,

  -- 労働時間（総合・平日・休日）
  work_hours numeric,
  overtime_hours numeric,
  night_hours numeric,
  weekday_work_hours numeric,
  weekday_overtime_hours numeric,
  weekday_night_hours numeric,
  holiday_work_hours numeric,
  holiday_overtime_hours numeric,
  holiday_night_hours numeric,

  -- みなし残業
  deemed_overtime_hours numeric,
  over_deemed_hours numeric,

  source text not null default 'jobcan',
  imported_at timestamptz not null default now(),
  imported_by uuid references public.employees(id) on delete set null,
  unique (employee_id, year, month)
);

-- ---- 2. 日ごとの明細 ----
create table if not exists public.legacy_attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  weekday text,
  status text,              -- 勤怠状況（有給・欠勤など）
  holiday_kind text,        -- 休日区分（祝日など）
  clock_in_actual text,     -- 出勤実時刻（実際に打刻した時刻）
  clock_out_actual text,    -- 退勤実時刻
  clock_in text,            -- 出勤時刻（計算に使われた時刻）
  clock_out text,           -- 退勤時刻
  break_hours numeric,
  work_hours numeric,
  note text,
  source text not null default 'jobcan',
  imported_at timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists legacy_days_employee_date_idx
  on public.legacy_attendance_days (employee_id, date);
create index if not exists legacy_months_employee_idx
  on public.legacy_attendance_months (employee_id, year, month);

-- ---- 3. 見られる人の決まり ----
alter table public.legacy_attendance_months enable row level security;
alter table public.legacy_attendance_days enable row level security;

drop policy if exists legacy_months_select on public.legacy_attendance_months;
create policy legacy_months_select on public.legacy_attendance_months
  for select using (employee_id = auth.uid() or public.is_admin());

drop policy if exists legacy_months_write on public.legacy_attendance_months;
create policy legacy_months_write on public.legacy_attendance_months
  for all using (public.is_master_admin()) with check (public.is_master_admin());

drop policy if exists legacy_days_select on public.legacy_attendance_days;
create policy legacy_days_select on public.legacy_attendance_days
  for select using (employee_id = auth.uid() or public.is_admin());

drop policy if exists legacy_days_write on public.legacy_attendance_days;
create policy legacy_days_write on public.legacy_attendance_days
  for all using (public.is_master_admin()) with check (public.is_master_admin());

-- ---- 4. 書き換えを防ぐ ----
-- 過去の記録は「当時こうだった」という記録です。
-- 取り込み直し（同じ月をもう一度入れる）はできますが、
-- 1行だけこっそり書き換えることはできないようにします。
create or replace function public.guard_legacy_update()
returns trigger
language plpgsql
as $$
begin
  raise exception '過去の記録は書き換えられません。取り込み直してください';
end;
$$;

drop trigger if exists guard_legacy_months_update on public.legacy_attendance_months;
create trigger guard_legacy_months_update
  before update on public.legacy_attendance_months
  for each row execute function public.guard_legacy_update();

drop trigger if exists guard_legacy_days_update on public.legacy_attendance_days;
create trigger guard_legacy_days_update
  before update on public.legacy_attendance_days
  for each row execute function public.guard_legacy_update();

-- ---- 5. 確認 ----
-- 流したあと、ここで出来ているか見られます
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_attendance_months') as "月ごとの表",
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_attendance_days') as "日ごとの表",
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename in ('legacy_attendance_months', 'legacy_attendance_days')) as "決まりの数";
