-- 65_payslip_edit_history.sql
--
-- 給与明細・賞与明細に「修正履歴」を持たせる（C-6）
--
-- 直す問題：
--   給与まわりで操作の履歴（監査ログ）に残っていたのは、公開・公開取消・
--   交通費の反映の3つだけでした。金額を作る・変える操作は記録されておらず、
--   「この手当はいつ誰が直したのか」という問い合わせに答えられませんでした。
--
-- 決めたこと：
--   明細ごとに履歴を持たせる。給与明細・賞与明細の画面でその明細の履歴を
--   そのまま見られるようにする。
--
-- 入れるもの：
--   1. payroll_records.edit_history（jsonb の配列）
--   2. bonus_records.edit_history（jsonb の配列）
--   3. 63番・64番の判定を少し直す
--      公開を取り消すときに履歴を1件足せるよう、edit_history は
--      「内容を変えた」とみなさないようにする
--
-- 履歴1件の形：
--   {
--     "at":       "2026-10-24T02:00:00.000Z",   … 操作した日時
--     "by_id":    "…uuid…",                     … 操作した人
--     "by_name":  "西野",
--     "action":   "金額を変更",                  … 何をしたか
--     "changes":  ["基本給 200,000円 → 210,000円"]  … 変わった項目（無い場合もある）
--   }
--   新しいものを配列の先頭に足していきます。
--
-- 何度流しても同じ結果になります。
-- 既存のデータは変更しません（列と既定値を足すだけです）。
-- すでにある明細の履歴は空の配列から始まります（過去にさかのぼっては作れません）。


-- ========================================================
-- 1. 列を足す
-- ========================================================
alter table public.payroll_records
  add column if not exists edit_history jsonb not null default '[]'::jsonb;

alter table public.bonus_records
  add column if not exists edit_history jsonb not null default '[]'::jsonb;


-- ========================================================
-- 2. 給与明細の判定を直す（63番の関数を入れ替え）
-- ========================================================
-- 変えたのは jold / jnew の組み立てだけです。
-- 公開を取り消すときに履歴を1件足せるよう、edit_history を比較から外しました。
create or replace function public.guard_payroll_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  jold jsonb;
  jnew jsonb;
begin
  -- ログインしていない呼び出し（service_role / サーバー処理）は素通し
  if auth.uid() is null then
    return new;
  end if;

  -- 何も変わらない更新は通す
  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return new;
  end if;

  -- 下書きのうちは今までどおり（公開もここを通る）
  if old.status is distinct from 'published' then
    return new;
  end if;

  -- ここから下は「公開済みの行を変えようとしている」場合

  -- 許可するのは公開の取り消しだけ
  if new.status = 'draft' and new.published_at is null then
    if not public.is_master_admin() then
      raise exception '公開済みの給与明細の公開を取り消せるのはマスター管理者のみです'
        using errcode = '42501';
    end if;
    -- 取り消しと同時に金額などを変えることは認めない。
    -- edit_history は取り消しの記録として足してよいので比較から外す
    jold := ((to_jsonb(old) - 'status') - 'published_at') - 'edit_history';
    jnew := ((to_jsonb(new) - 'status') - 'published_at') - 'edit_history';
    if jold is distinct from jnew then
      raise exception '公開を取り消すときは、同時に内容を変更できません。取り消したあとに修正してください'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception '公開済みの給与明細は変更できません。先に公開を取り消してください'
    using errcode = '42501';
end;
$func$;


-- ========================================================
-- 3. 賞与明細の判定を直す（64番の関数を入れ替え）
-- ========================================================
create or replace function public.guard_bonus_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  jold jsonb;
  jnew jsonb;
begin
  if auth.uid() is null then
    return new;
  end if;

  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return new;
  end if;

  if old.status is distinct from 'published' then
    return new;
  end if;

  if new.status = 'draft' and new.published_at is null then
    if not public.is_master_admin() then
      raise exception '公開済みの賞与明細の公開を取り消せるのはマスター管理者のみです'
        using errcode = '42501';
    end if;
    -- updated_at と edit_history は取り消しの記録として変わってよい
    jold := (((to_jsonb(old) - 'status') - 'published_at') - 'updated_at') - 'edit_history';
    jnew := (((to_jsonb(new) - 'status') - 'published_at') - 'updated_at') - 'edit_history';
    if jold is distinct from jnew then
      raise exception '公開を取り消すときは、同時に内容を変更できません。取り消したあとに修正してください'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception '公開済みの賞与明細は変更できません。先に公開を取り消してください'
    using errcode = '42501';
end;
$func$;


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select '給与明細の履歴の列' as 確認項目,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'payroll_records' and column_name = 'edit_history'
       ) then '追加済み' else '未追加' end as 結果,
       '追加済み であれば正常' as 期待値

union all

select '賞与明細の履歴の列',
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'bonus_records' and column_name = 'edit_history'
       ) then '追加済み' else '未追加' end,
       '追加済み であれば正常'

union all

select '給与明細の判定（63番の更新）',
       case when pg_get_functiondef(p.oid) like '%edit_history%' then '更新済み' else '未更新' end,
       '更新済み であれば正常'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'guard_payroll_published'

union all

select '賞与明細の判定（64番の更新）',
       case when pg_get_functiondef(p.oid) like '%edit_history%' then '更新済み' else '未更新' end,
       '更新済み であれば正常'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'guard_bonus_published';
