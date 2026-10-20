-- 34_shift_requests.sql
--
-- シフト希望の回収（第1段階）。
--   管理者が対象月の受付を開始 → スタッフが1日ごとに ● / × / 有給 を提出
--   → 管理者が一覧で確認し、CSVに書き出してスプレッドシートへ貼り付ける
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

-- 対象月ごとの受付設定（1行＝1か月）
create table if not exists public.shift_request_periods (
  target_month text primary key,               -- 'YYYY-MM'
  is_open boolean not null default true,       -- 受付中かどうか
  deadline date,                               -- 提出の締切
  request_days jsonb not null default '[]'::jsonb, -- 出勤依頼日（'YYYY-MM-DD' の配列）
  note text,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.shift_request_periods enable row level security;

-- 全員が受付の状態を見られる（スタッフは提出画面の表示に使う）
drop policy if exists "shift period select" on public.shift_request_periods;
create policy "shift period select"
  on public.shift_request_periods for select to authenticated
  using (true);

-- 受付の開始・締切の設定は管理者のみ
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

-- スタッフの希望（1行＝1人×1か月）
create table if not exists public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_month text not null,                  -- 'YYYY-MM'
  answers jsonb not null default '{}'::jsonb,  -- { 'YYYY-MM-DD': 'ok' | 'off' | 'paid' }
  note text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (employee_id, target_month)
);

alter table public.shift_requests enable row level security;

-- 本人は自分の分を、管理者は全員分を見られる
drop policy if exists "shift request select" on public.shift_requests;
create policy "shift request select"
  on public.shift_requests for select to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  );

-- 本人が自分の分を提出できる
drop policy if exists "shift request insert" on public.shift_requests;
create policy "shift request insert"
  on public.shift_requests for insert to authenticated
  with check (employee_id = auth.uid());

-- 本人は締切前に出し直せる。管理者も修正できる
drop policy if exists "shift request update" on public.shift_requests;
create policy "shift request update"
  on public.shift_requests for update to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  )
  with check (true);

notify pgrst, 'reload schema';
