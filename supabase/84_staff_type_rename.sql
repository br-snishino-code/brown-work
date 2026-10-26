-- 84_staff_type_rename.sql
--
-- スタッフ種別（雇用形態）の整理
--
--   「社員」      → 「正社員」に改名
--   「SV」        → 「正社員」に変更
--   「RSV」       → 「正社員」に変更
--   「代表取締役」 → 「正社員」に変更
--
-- SV・RSV・代表取締役は雇用形態ではなく役職のため、種別の一覧から外しました。
-- 該当する方は全員「正社員」に変えます（御社に確認済み）。
-- 役職は、スタッフの「詳細」→「業務・契約」タブの「役職」欄に入れてください。
--
-- ⚠ 土日祝皆勤手当に影響します。
--   この手当の対象は「正社員」と「如意棒（社員）」です。
--   このSQLを流すまで、対象の方が「社員」のままだと手当が0円になります。
--
-- 流す順番：
--   アプリのデプロイを先にしてから、このSQLを流してください。
--   先にSQLを流すと、古いアプリの一覧に「正社員」が無いため、
--   スタッフ詳細の種別の欄が空に見えます（値は壊れません）。
--   新しいアプリは、一覧に無い値も「（一覧にない値）」として選択欄に出すので、
--   どちらの順番でも値が消えることはありません。
--
-- 何度流しても同じ結果になります。
--
-- ※ Supabase の SQL Editor にそのまま貼り付けて実行できます。


-- ========================================================
-- 1. 流す前の確認（先にこれだけ実行して人数を見てください）
-- ========================================================
select coalesce(nullif(staff_type, ''), '未設定') as "いまの種別",
       count(*) as "人数",
       count(*) filter (where resignation_date is null) as "うち在籍"
from public.employees
group by 1
order by 2 desc;


-- ========================================================
-- 2. まとめて変更
-- ========================================================
-- employees の staff_type には制約が無いため、ここで値を揃えます。
-- 「如意棒（社員）」は別の種別なので触りません（in で完全一致のみ）。
update public.employees
   set staff_type = '正社員'
 where staff_type in ('社員', 'SV', 'RSV', '代表取締役');


-- ========================================================
-- 3. 確認
-- ========================================================
select '① 古い種別が残っていないか（0なら成功）' as "確認項目",
       (select count(*)::text from public.employees
        where staff_type in ('社員', 'SV', 'RSV', '代表取締役')) as "結果"
union all
select '② 正社員の人数',
       (select count(*)::text from public.employees where staff_type = '正社員')
union all
select '③ 土日祝皆勤手当の対象になりうる在籍者（正社員＋如意棒（社員））',
       (select count(*)::text from public.employees
        where resignation_date is null
          and staff_type in ('正社員', '如意棒（社員）'))
union all
select '④ 一覧にない種別が残っている人数（0なら成功）',
       (select count(*)::text from public.employees
        where coalesce(nullif(staff_type, ''), '') <> ''
          and staff_type not in (
            '正社員', 'スポット', '外部', '総務部',
            '契約社員（週5）', '契約社員（スポット）',
            '如意棒（社員）', '如意棒（スポット）'
          ));


-- ========================================================
-- 4. 変更後の内訳
-- ========================================================
select coalesce(nullif(staff_type, ''), '未設定') as "種別",
       count(*) as "人数",
       count(*) filter (where resignation_date is null) as "うち在籍"
from public.employees
group by 1
order by 2 desc;
