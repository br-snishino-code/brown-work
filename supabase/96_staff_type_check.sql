-- 96_staff_type_check.sql
--
-- 【確認だけのファイルです。何も変えません】
--
-- なぜ確認するか：
--   2026年11月から、スタッフ種別（employees.staff_type）が登録されていない方を
--   画面で「未設定」と出すようにしました。
--   それまでは空のときに「正社員」として扱っていたため、
--   いま空の方がいると、次の2つの扱いが変わります。
--
--     ・法定休日の決め方
--         これまで … 「正社員」用の決め方（設定していればそちら）
--         これから … 全体の決め方
--     ・給与の既定項目（支給・控除の初期値）
--         これまで … 「メイングループ ／ 正社員」のグループ
--         これから … 「メイングループ ／ (種別未設定)」のグループ
--
--   有休の比例付与と、役員かどうかの判定は変わりません（どちらも対象外のままです）。
--
--   ①で0件なら、変わる方はいません。そのままお使いください。
--   ①に名前が出た方は、画面（人材 → スタッフ一覧 → スタッフ種別「未設定」で絞り込み）
--   から種別を選んで保存してください。選べばこれまでと同じ扱いに戻ります。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


-- ============================================================
-- ① スタッフ種別が未設定の方（ここが0件なら影響なし）
-- ============================================================
select e.name                                   as 氏名,
       coalesce(e.staff_number, '（未登録）')     as スタッフコード,
       coalesce(e.main_group, '（未設定）')       as メイングループ,
       e.hire_date                              as 入社日,
       case when e.resignation_date is null then '在籍' else '退職済み' end as 在籍,
       case when e.staff_type is null then 'NULL' else '空文字' end         as 空の種類
  from public.employees e
 where coalesce(nullif(e.staff_type, ''), '') = ''
 order by (e.resignation_date is not null), e.name;


-- ============================================================
-- ② いまの種別の内訳（全体像の確認用）
-- ============================================================
select coalesce(nullif(staff_type, ''), '（未設定）')   as 種別,
       count(*)                                         as 人数,
       count(*) filter (where resignation_date is null) as うち在籍
  from public.employees
 group by coalesce(nullif(staff_type, ''), '（未設定）')
 order by 人数 desc, 種別;


-- ============================================================
-- ③ 給与の既定項目のグループが、未設定の方のぶんだけ分かれていないか
--    （①が0件なら実行する必要はありません）
-- ============================================================
select coalesce(nullif(e.main_group, ''), '（グループ未設定）') as メイングループ,
       coalesce(nullif(e.staff_type, ''), '（種別未設定）')     as 種別,
       count(*)                                                as 在籍人数
  from public.employees e
 where e.resignation_date is null
 group by 1, 2
 order by 1, 2;
