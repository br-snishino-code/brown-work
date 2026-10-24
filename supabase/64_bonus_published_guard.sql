-- 64_bonus_published_guard.sql
--
-- 公開済みの賞与明細を、データベース側で守る
--
-- 直す問題：
--   63番で給与明細を守ったあと、賞与明細に同じ形の問題が残っていました。
--     ・賞与明細の画面は、公開済みでも「この内容で上書きする」ボタンが出ており、
--       公開済みの金額をそのまま書き換えられた。
--       （給与明細と違い status を書き換えないため非公開には戻らないが、
--         スタッフが受け取った明細の金額があとから変わってしまう）
--     ・画面を通らない操作では何も止められなかった。
--
-- 決めたルール（給与明細と同じ扱い）：
--   ・公開済みの賞与明細は変更できない。直すときは先に公開を取り消す。
--   ・公開を取り消せるのはマスター管理者のみ。
--   ・公開の取り消しと内容の変更は、同時にはできない。
--
-- 守る範囲：
--   更新（UPDATE）のみです。削除（DELETE）は止めていません。
--   （63番の給与明細と同じ範囲に揃えています）
--
-- 何度流しても同じ結果になります。
-- 既存のデータは変更しません（判定を足すだけです）。


-- ========================================================
-- 判定の中身
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
      raise exception '公開済みの賞与明細の公開を取り消せるのはマスター管理者のみです'
        using errcode = '42501';
    end if;
    -- 取り消しと同時に金額などを変えることは認めない。
    -- updated_at は取り消しの記録として変わってよいので比較から外す
    jold := ((to_jsonb(old) - 'status') - 'published_at') - 'updated_at';
    jnew := ((to_jsonb(new) - 'status') - 'published_at') - 'updated_at';
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


-- ========================================================
-- トリガーの設定
-- ========================================================
drop trigger if exists guard_bonus_published on public.bonus_records;
create trigger guard_bonus_published
  before update on public.bonus_records
  for each row execute function public.guard_bonus_published();


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select '判定の関数' as 確認項目,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'guard_bonus_published'
       ) then '作成済み' else '未作成' end as 結果,
       '作成済み であれば正常' as 期待値

union all

select 'トリガー',
       case when exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal
           and c.relname = 'bonus_records'
           and t.tgname = 'guard_bonus_published'
       ) then '設定済み' else '未設定' end,
       '設定済み であれば正常'

union all

select '状態が食い違っている既存の行',
       count(*)::text || '件',
       '0件 であれば正常'
from public.bonus_records
where (status = 'draft' and published_at is not null)
   or (status = 'published' and published_at is null);
