-- 46_app_state_lockdown.sql
--
-- 【緊急・セキュリティ修正②】旧 app_state テーブルの鍵を閉め直す
--
-- 経緯：
--   app_state は Supabase Auth に移行する前の方式で、
--   全社員のデータ（当時は平文パスワードを含む）を1行のJSONに入れていた表。
--   00_emergency_lockdown.sql で anon 向けのポリシーを削除したはずだったが、
--   現状を確認したところ、次の3つが anon（ログイン不要）向けに復活していた：
--     brown_work_select / brown_work_insert / brown_work_update
--   anon キーはアプリのJavaScriptに埋め込まれる前提のキーなので、
--   このままだと URL とキーを知っていれば誰でも中身を読める。
--
-- アプリへの影響：
--   現在のアプリは app_state を一切読み書きしていない
--   （src/App.tsx に残っているのはコメント2行のみ）。
--   そのため、閉じてもアプリの動作は変わらない。
--
-- このSQLでやること：
--   1. anon / authenticated 向けのポリシーをすべて削除する
--      （= service_role 以外からは触れなくなる。データは消えない）
--   2. 念のため権限も取り消す
--
-- テーブルごと削除するかどうかは、中身を確認してから別途判断する。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

do $$
declare
  p record;
begin
  if to_regclass('public.app_state') is null then
    raise notice 'app_state テーブルはありません（対応不要）';
    return;
  end if;

  -- 付いているポリシーを名前にかかわらずすべて削除する
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'app_state'
  loop
    execute format('drop policy if exists %I on public.app_state', p.policyname);
    raise notice 'ポリシーを削除しました: %', p.policyname;
  end loop;

  -- RLS は有効のまま（ポリシーが無い＝誰も通れない状態にする）
  execute 'alter table public.app_state enable row level security';

  -- 念のためテーブル権限も取り消す
  execute 'revoke all on public.app_state from anon';
  execute 'revoke all on public.app_state from authenticated';
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- 確認：この下の select で「ポリシー 0件」になっていれば完了
-- ============================================================
select
  'app_state のポリシー' as 確認項目,
  coalesce(
    (select count(*)::text || '件' from pg_policies
      where schemaname = 'public' and tablename = 'app_state'),
    '-') as 状態
union all
select 'app_state の行数',
       coalesce((select count(*)::text || '行' from public.app_state), '-')
union all
select 'anon に残っている権限',
       coalesce((select string_agg(privilege_type, ', ')
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'app_state'
                    and grantee = 'anon'), '（なし）')
union all
select 'authenticated に残っている権限',
       coalesce((select string_agg(privilege_type, ', ')
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'app_state'
                    and grantee = 'authenticated'), '（なし）');
