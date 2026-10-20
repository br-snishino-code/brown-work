-- 37_shift_request_answers.sql
--
-- シフト希望の保存先を shift_request_answers に変更する。
--
-- 経緯：初期スキーマ（01_schema.sql）に、1日1行の古い設計の
-- public.shift_requests がすでに存在していたため、34番の
-- create table if not exists では新しい形のテーブルが作られず、
-- 「Could not find the 'answers' column」になっていた。
-- 既存のテーブルとデータには触れず、新しい名前で作り直す。
--
-- 34番・36番を実行済みでも問題ありません。このファイルだけ実行してください。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

create table if not exists public.shift_request_answers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_month text not null,                  -- 'YYYY-MM'
  answers jsonb not null default '{}'::jsonb,  -- { 'YYYY-MM-DD': 'ok' | 'off' | 'paid' }
  note text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (employee_id, target_month)
);

alter table public.shift_request_answers enable row level security;

-- 本人は自分の分を、管理者は全員分を見られる
drop policy if exists "shift answer select" on public.shift_request_answers;
create policy "shift answer select"
  on public.shift_request_answers for select to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  );

-- 本人が自分の分を提出できる
drop policy if exists "shift answer insert" on public.shift_request_answers;
create policy "shift answer insert"
  on public.shift_request_answers for insert to authenticated
  with check (employee_id = auth.uid());

-- 本人は出し直せる。管理者も修正できる
drop policy if exists "shift answer update" on public.shift_request_answers;
create policy "shift answer update"
  on public.shift_request_answers for update to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  )
  with check (true);

-- 受付設定のテーブル（34番で作成済み。未作成の場合に備えて）
create table if not exists public.shift_request_periods (
  target_month text primary key,
  is_open boolean not null default true,
  deadline date,
  request_days jsonb not null default '[]'::jsonb,
  target_employee_ids jsonb,
  note text,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.shift_request_periods
  add column if not exists target_employee_ids jsonb;

alter table public.shift_request_periods enable row level security;

drop policy if exists "shift period select" on public.shift_request_periods;
create policy "shift period select"
  on public.shift_request_periods for select to authenticated
  using (true);

drop policy if exists "shift period insert" on public.shift_request_periods;
create policy "shift period insert"
  on public.shift_request_periods for insert to authenticated
  with check (
    exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  );

drop policy if exists "shift period update" on public.shift_request_periods;
create policy "shift period update"
  on public.shift_request_periods for update to authenticated
  using (
    exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  )
  with check (true);

notify pgrst, 'reload schema';
