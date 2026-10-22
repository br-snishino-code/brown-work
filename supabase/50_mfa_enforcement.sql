-- 50_mfa_enforcement.sql
--
-- 【任意・2段階認証を設定した人にだけ効く】
-- 2段階認証を「画面の見た目だけ」で終わらせないための仕上げ。
--
-- 背景：
--   アプリの画面側では、コードを入れるまでデータを読み込まないようにしている。
--   ただしそれはブラウザの中の処理なので、パスワードだけで取得した
--   トークンを使って API を直接叩けば、コードを入れずにデータを読めてしまう。
--   それを止めるには、データベース側でも「コードを入れ終わった人か」を見る必要がある。
--
-- このSQLでやること：
--   2段階認証を登録している人に限り、コードを入れ終わった状態
--   （Supabase でいう aal2）でなければ、下に挙げた表を読み書きできなくする。
--   2段階認証を登録していない人には一切影響しない。
--   Edge Function（service_role）も影響を受けない。
--
-- 実行のタイミング：
--   2段階認証を1人で設定して、ログインできることを確かめてから実行してください。
--   先に実行しても害はありませんが、順番を守ると切り分けが楽です。
--
-- 元に戻したいとき：
--   このファイルの末尾にある「解除」のSQLを実行してください。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

-- ------------------------------------------------------------
-- 判定用の関数
--   2段階認証を登録していない人 … いつでも true（これまでどおり）
--   登録している人             … コードを入れ終わっていれば true
-- ------------------------------------------------------------
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $func$
  select case
    when exists (
      select 1 from auth.mfa_factors f
       where f.user_id = auth.uid() and f.status = 'verified'
    )
    then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    else true
  end;
$func$;

-- ------------------------------------------------------------
-- 対象の表に「制限ポリシー」を足す
--   制限ポリシー（restrictive）は、既存のポリシーと AND で効く。
--   つまり、これまで読めていた範囲がさらに狭まるだけで、
--   新しく何かが読めるようになることはない。
-- ------------------------------------------------------------
do $do$
declare
  t text;
  targets text[] := array[
    'employees',
    'employee_my_numbers',
    'payroll_records',
    'bonus_records',
    'year_end_adjustments',
    'attendance_records',
    'commute_expense_claims',
    'employee_standard_remuneration',
    'employee_salary_items',
    'audit_logs',
    'login_attempts'
  ];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice 'スキップ（表がありません）: %', t;
      continue;
    end if;
    execute format('drop policy if exists "mfa required" on public.%I', t);
    execute format(
      'create policy "mfa required" on public.%I as restrictive to authenticated '
      || 'using (public.mfa_ok()) with check (public.mfa_ok())', t);
    raise notice '適用しました: %', t;
  end loop;
end $do$;

notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select
  tablename as テーブル,
  policyname as ポリシー,
  permissive as 種別
from pg_policies
where schemaname = 'public' and policyname = 'mfa required'
order by tablename;


-- ============================================================
-- 解除したいとき（この下だけを選んで実行）
-- ============================================================
-- do $do$
-- declare r record;
-- begin
--   for r in select tablename from pg_policies
--             where schemaname = 'public' and policyname = 'mfa required'
--   loop
--     execute format('drop policy if exists "mfa required" on public.%I', r.tablename);
--   end loop;
-- end $do$;
-- notify pgrst, 'reload schema';
