-- 43_shift_assignments.sql
--
-- 確定シフト（スプレッドシートで組んだ結果）を保存するテーブル。
-- シフト希望（shift_request_answers）とは別物で、こちらが「決まったシフト」。
--
--   kind  … 'work'（出勤）| 'off'（休み）| 'paid'（有給）
--   place … 活動場所。スプレッドシートのセルに書かれた店舗名などをそのまま入れる
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  kind text not null default 'off',
  place text,
  source text not null default 'sheet',
  imported_at timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists shift_assignments_date_idx on public.shift_assignments (date);
create index if not exists shift_assignments_employee_idx on public.shift_assignments (employee_id);

alter table public.shift_assignments enable row level security;

-- 本人は自分の分、管理者は全員分を見られる
drop policy if exists "shift assignment select" on public.shift_assignments;
create policy "shift assignment select" on public.shift_assignments
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- 書き込みは管理者のみ（取り込みは service role で行うため、この制限で問題ない）
drop policy if exists "shift assignment write" on public.shift_assignments;
create policy "shift assignment write" on public.shift_assignments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 取り込みの履歴。いつ・どの月を・何件入れたかを残す
create table if not exists public.shift_import_logs (
  id uuid primary key default gen_random_uuid(),
  target_month text not null,
  sheet_name text,
  total_rows int not null default 0,
  matched_rows int not null default 0,
  unmatched_names jsonb not null default '[]'::jsonb,
  assignment_count int not null default 0,
  imported_at timestamptz not null default now()
);

alter table public.shift_import_logs enable row level security;

drop policy if exists "shift import log select" on public.shift_import_logs;
create policy "shift import log select" on public.shift_import_logs
  for select to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';
