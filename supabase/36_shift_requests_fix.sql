-- 36_shift_requests_fix.sql
--
-- 「Could not find the 'answers' column of 'shift_requests'（PGRST204）」が出るときの修復用。
-- 34_shift_requests.sql が一部だけ実行された場合や、
-- PostgREST のスキーマキャッシュが古いままの場合に実行してください。
-- 何度実行しても安全です（足りないものだけを足します）。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

-- テーブルが無ければ作る
create table if not exists public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_month text not null,
  answers jsonb not null default '{}'::jsonb,
  note text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 足りない列を足す
alter table public.shift_requests
  add column if not exists target_month text,
  add column if not exists answers jsonb not null default '{}'::jsonb,
  add column if not exists note text,
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();

-- 1人1か月で1行にする制約（upsert に必要）
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shift_requests'::regclass
      and contype = 'u'
  ) then
    alter table public.shift_requests
      add constraint shift_requests_employee_month_key unique (employee_id, target_month);
  end if;
end $$;

-- 受付設定のテーブルと列も合わせて確認する
create table if not exists public.shift_request_periods (
  target_month text primary key,
  is_open boolean not null default true,
  deadline date,
  request_days jsonb not null default '[]'::jsonb,
  note text,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.shift_request_periods
  add column if not exists is_open boolean not null default true,
  add column if not exists deadline date,
  add column if not exists request_days jsonb not null default '[]'::jsonb,
  add column if not exists target_employee_ids jsonb,
  add column if not exists note text,
  add column if not exists opened_by uuid,
  add column if not exists opened_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();

-- RLS とポリシー（34番と同じ内容。すでにあれば入れ直すだけ）
alter table public.shift_requests enable row level security;
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

drop policy if exists "shift request select" on public.shift_requests;
create policy "shift request select"
  on public.shift_requests for select to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  );

drop policy if exists "shift request insert" on public.shift_requests;
create policy "shift request insert"
  on public.shift_requests for insert to authenticated
  with check (employee_id = auth.uid());

drop policy if exists "shift request update" on public.shift_requests;
create policy "shift request update"
  on public.shift_requests for update to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  )
  with check (true);

-- スキーマキャッシュを読み直す（これをしないと列が見つからないままになる）
notify pgrst, 'reload schema';
