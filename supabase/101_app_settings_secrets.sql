-- 101_app_settings_secrets.sql
--
-- 【セキュリティ修正】会社の口座番号などを、全スタッフから読めないようにする
--
-- 経緯：
--   app_settings の読み取りポリシーは
--     create policy "app settings select" on public.app_settings
--       for select to authenticated using (true);
--   で、ログインした人は全員すべての設定を読めた。
--   そこには次のものが入る（入る予定のものを含む）：
--     ・transfer_payer   … 会社の口座番号・委託者コード・支店コード（振込データ用）
--     ・labor_insurance  … 労働保険番号
--     ・office_info      … 事業所記号・事業所番号・雇用保険適用事業所番号・事業主住所
--   いずれも全スタッフが読む必要はない。
--
-- このSQLでやること：
--   ① 上の3つのキーだけ、マスター管理者しか読めないようにする
--   ② 給与明細・賞与明細に出す会社名を company_name というキーに写す
--      （明細はスタッフ本人も見るため。事業所名称だけを切り出す）
--
-- 変えないこと：
--   ・書き込みは、これまでどおりマスター管理者のみ
--   ・保険料率・支給日・所定勤務時間・36協定・給与項目など、
--     画面の計算に使う設定は、これまでどおり全員が読める
--   ・admin_notify_email（管理者への通知先）も、これまでどおり全員が読める
--     （個人情報の変更申請などで、スタッフ側から通知メールを送るのに要るため）
--
-- 実行の順番：
--   1. このSQLを実行する
--   2. アプリの新しい版が反映されるのを待つ
--
--   先にこのSQLを実行しても画面は動きます。
--   アプリが古いあいだ、スタッフが見る明細の会社名が
--   一時的に出なくなることがあります（②で写すので、通常は出ます）。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

begin;

-- 前提の確認
do $pre$
begin
  if to_regclass('public.app_settings') is null then
    raise exception 'public.app_settings がありません。先に 27 を適用してください';
  end if;
  if to_regprocedure('public.is_master_admin()') is null then
    raise exception 'public.is_master_admin() がありません。先に 08 を適用してください';
  end if;
end $pre$;


-- ------------------------------------------------------------
-- ② 先に会社名を写します
--    （①でポリシーを絞ったあとでも読めるように、順番はこちらが先）
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
select 'company_name', coalesce(nullif(trim(s.value::jsonb ->> 'nameKanji'), ''), '')
  from public.app_settings s
 where s.key = 'office_info'
   and s.value is not null
   and trim(s.value) <> ''
   and jsonb_typeof(s.value::jsonb) = 'object'
on conflict (key) do update
  set value = excluded.value;


-- ------------------------------------------------------------
-- ① 機密のキーは、マスター管理者だけが読めるようにする
-- ------------------------------------------------------------
drop policy if exists "app settings select" on public.app_settings;

create policy "app settings select"
  on public.app_settings for select to authenticated
  using (
    key not in ('transfer_payer', 'labor_insurance', 'office_info')
    or public.is_master_admin()
  );

commit;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：次の2つが出れば成功です
--   ・隠したキーの数 … いま登録されているものだけ数えます（0〜3件）
--   ・会社名        … 事業所情報を登録済みなら、会社名が入ります
-- ------------------------------------------------------------
select
  (select count(*) from public.app_settings
    where key in ('transfer_payer', 'labor_insurance', 'office_info')) as "隠したキーのうち登録済み",
  coalesce((select value from public.app_settings where key = 'company_name'), '（未登録）') as "明細に出す会社名",
  (select count(*) from public.app_settings) as "設定の総数";
