-- 29_commute_claim_columns.sql
--
-- 交通費精算書の表に、あとから追加された項目が無いため申請が保存できない。
-- 不足している列を追加する。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.commute_expense_claims
  add column if not exists target_month text,
  add column if not exists submitted_date date,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists total_amount numeric not null default 0,
  add column if not exists status text not null default 'pending',
  add column if not exists admin_comment text,
  add column if not exists decided_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

-- 変更を即座に反映させる
notify pgrst, 'reload schema';
