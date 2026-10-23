-- 59c_export_policies.sql — アクセス制限（RLSポリシー）の中身
--
-- 本番のテーブル定義を書き出すSQL（3／3）。読み取るだけで、何も変更しません。
--
-- ※ Supabase の SQL Editor は、複数の文をまとめて実行すると
--    最後の結果しか表示しません。そのため1ファイルに1つだけ入れています。
--    このファイルの中身をそのまま貼り付けて Run し、
--    結果表の右上から CSV で書き出してお送りください。

select
  tablename   as テーブル,
  policyname  as ポリシー,
  permissive  as 種別,
  roles::text as 対象ロール,
  cmd         as 操作,
  coalesce(qual, '')       as 読める条件,
  coalesce(with_check, '') as 書ける条件
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
