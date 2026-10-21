-- 44_shift_integration.sql
--
-- シフト連携の改善にともなう追加。
--   1. shift_name_aliases      … スプレッドシート上の氏名とスタッフの対応表
--   2. shift_assignment_changes … 確定シフトの変更履歴（取り込みのたびに差分を残す）
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

-- ---- 1. 氏名の対応表 ----
-- スプレッドシートの表記（改姓前の姓、表記ゆれなど）とスタッフを結びつける。
-- 一度登録すれば、以後の取り込みで自動的に一致する。
create table if not exists public.shift_name_aliases (
  sheet_name text primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists shift_name_aliases_employee_idx on public.shift_name_aliases (employee_id);

alter table public.shift_name_aliases enable row level security;

drop policy if exists "shift alias select" on public.shift_name_aliases;
create policy "shift alias select" on public.shift_name_aliases
  for select to authenticated
  using (public.is_admin());

drop policy if exists "shift alias write" on public.shift_name_aliases;
create policy "shift alias write" on public.shift_name_aliases
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---- 2. 確定シフトの変更履歴 ----
-- 取り込みのたびに、前回と違う日だけを記録する。
--   before_kind が null … 新しく入った日
--   after_kind  が null … 取り込み対象から外れた日
create table if not exists public.shift_assignment_changes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  target_month text not null,
  before_kind text,
  before_place text,
  after_kind text,
  after_place text,
  changed_at timestamptz not null default now()
);

create index if not exists shift_changes_month_idx on public.shift_assignment_changes (target_month);
create index if not exists shift_changes_changed_at_idx on public.shift_assignment_changes (changed_at desc);
create index if not exists shift_changes_employee_idx on public.shift_assignment_changes (employee_id);

alter table public.shift_assignment_changes enable row level security;

-- 本人は自分の分、管理者は全員分
drop policy if exists "shift change select" on public.shift_assignment_changes;
create policy "shift change select" on public.shift_assignment_changes
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

notify pgrst, 'reload schema';
