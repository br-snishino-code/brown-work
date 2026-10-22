-- 53_my_number_lockdown.sql
--
-- 【セキュリティ修正】マイナンバーの表への直接アクセスを塞ぐ
--
-- 経緯：
--   マイナンバーは employee_my_numbers.my_number_encrypted に
--   平文のまま入っていた（列名に反して暗号化していなかった）。
--   暗号化を Edge Function（my-number）に移したので、
--   アプリから表を直接読み書きする必要がなくなった。
--
-- このSQLでやること：
--   authenticated（ログインしたユーザー）向けのポリシーをすべて削除する。
--   削除後、この表に触れるのは service_role だけ、つまり
--   my-number 関数だけになる。
--   番号の閲覧・保存・廃棄は、すべてその関数を通り、
--   必ず監査ログに記録される。
--
-- 実行の順番：
--   1. MY_NUMBER_KEY を設定する
--   2. my-number 関数をデプロイする
--   3. このSQLを実行する
--   4. アプリの新しい版が反映されるのを待つ
--
--   先にこのSQLを実行しても、マイナンバー以外の画面は動きます。
--   マイナンバーの登録・閲覧だけが、新しい版が出るまで一時的に
--   使えなくなります。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

do $do$
declare
  p record;
begin
  if to_regclass('public.employee_my_numbers') is null then
    raise notice 'employee_my_numbers がありません（対応不要）';
    return;
  end if;

  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'employee_my_numbers'
  loop
    execute format('drop policy if exists %I on public.employee_my_numbers', p.policyname);
    raise notice 'ポリシーを削除しました: %', p.policyname;
  end loop;

  -- RLS は有効のまま（ポリシーが無い＝誰も通れない状態にする）
  execute 'alter table public.employee_my_numbers enable row level security';

  -- 念のためテーブル権限も取り消す
  execute 'revoke all on public.employee_my_numbers from anon';
  execute 'revoke all on public.employee_my_numbers from authenticated';
end $do$;

notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select 'ポリシー' as 確認項目,
       coalesce((select count(*)::text || '件' from pg_policies
                  where schemaname = 'public' and tablename = 'employee_my_numbers'), '-') as 状態
union all
select 'anon に残っている権限',
       coalesce((select string_agg(privilege_type, ', ')
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'employee_my_numbers'
                    and grantee = 'anon'), '（なし）')
union all
select 'authenticated に残っている権限',
       coalesce((select string_agg(privilege_type, ', ')
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'employee_my_numbers'
                    and grantee = 'authenticated'), '（なし）')
union all
select '保存されている件数',
       (select count(*)::text || '件' from public.employee_my_numbers);
