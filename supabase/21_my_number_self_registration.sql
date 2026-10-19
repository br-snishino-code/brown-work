-- 21_my_number_self_registration.sql
--
-- 初回ログイン時の「ご登録情報の入力」画面で、ご本人がご自身のマイナンバーを
-- 登録できるようにするための設定。
--
-- ・登録できるのは「ご自身の番号」のみ（他人の番号は登録も閲覧もできません）
-- ・ご自身の番号はご本人も確認できます
-- ・他人の番号を閲覧できるのは、これまでどおりマスター管理者のみです
--   （既存のポリシーはそのまま残ります。この設定は追加のみです）
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

-- 念のためテーブルが無い場合は作成する
create table if not exists public.employee_my_numbers (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  my_number_encrypted text,
  purposes text[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.employee_my_numbers enable row level security;

-- ご本人がご自身の行を登録できる
drop policy if exists "own my number insert" on public.employee_my_numbers;
create policy "own my number insert"
  on public.employee_my_numbers
  for insert
  to authenticated
  with check (employee_id = auth.uid());

-- ご本人がご自身の行を更新できる
drop policy if exists "own my number update" on public.employee_my_numbers;
create policy "own my number update"
  on public.employee_my_numbers
  for update
  to authenticated
  using (employee_id = auth.uid())
  with check (employee_id = auth.uid());

-- ご本人がご自身の行を確認できる
drop policy if exists "own my number select" on public.employee_my_numbers;
create policy "own my number select"
  on public.employee_my_numbers
  for select
  to authenticated
  using (employee_id = auth.uid());
