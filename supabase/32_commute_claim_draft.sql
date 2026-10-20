-- 32_commute_claim_draft.sql
--
-- 交通費精算に「一時保存（draft）」の状態を追加するための準備。
-- status に値を制限する設定が残っている場合、draft が保存できないため取り除く。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run
-- （該当する設定が無い場合は、何も起きずに終了します）

do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.commute_expense_claims'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.commute_expense_claims drop constraint %I', c.conname);
  end loop;
end $$;

notify pgrst, 'reload schema';
