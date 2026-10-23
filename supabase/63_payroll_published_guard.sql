-- 63_payroll_published_guard.sql
--
-- 公開済みの給与明細を、データベース側で守る
--
-- 直す問題（C-1 / C-2）：
--   これまで「公開済みの明細を守る」判定は画面（React）側にしかなく、
--   データベース側には何もありませんでした。
--   そのため次のことが起きていました。
--     ・給与計算の画面で「この内容で再計算・保存」を押すと、
--       公開済みの明細が下書きに戻り、スタッフの画面から消える。
--       しかも公開日時だけ残るため、状態が食い違った行になる。
--     ・画面を通らない操作（APIを直接たたく、SQL Editor など）では
--       そもそも何も止められない。
--
-- 決めたルール：
--   ・公開済みの明細は変更できない。直すときは先に公開を取り消す。
--   ・公開を取り消せるのはマスター管理者のみ（交通費の承認取消と同じ扱い）。
--   ・公開の取り消しと内容の変更は、同時にはできない。
--     取り消して下書きに戻してから、内容を直して再公開する。
--
-- 守る範囲：
--   更新（UPDATE）のみです。削除（DELETE）は今回のルールに含めていないため
--   止めていません。公開済み明細の削除も禁止するかは別途ご判断ください。
--
-- 何度流しても同じ結果になります。
-- 既存のデータは変更しません（判定を足すだけです）。


-- ========================================================
-- 判定の中身
-- ========================================================
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

  -- 許可するのは公開の取り消しだけ。
  -- 状態を下書きに戻し、公開日時を空にするのが「取り消し」。
  if new.status = 'draft' and new.published_at is null then
    if not public.is_master_admin() then
      raise exception '公開済みの給与明細の公開を取り消せるのはマスター管理者のみです'
        using errcode = '42501';
    end if;
    -- 取り消しと同時に金額などを変えることは認めない
    jold := (to_jsonb(old) - 'status') - 'published_at';
    jnew := (to_jsonb(new) - 'status') - 'published_at';
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
-- トリガーの設定
-- ========================================================
drop trigger if exists guard_payroll_published on public.payroll_records;
create trigger guard_payroll_published
  before update on public.payroll_records
  for each row execute function public.guard_payroll_published();


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select '判定の関数' as 確認項目,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'guard_payroll_published'
       ) then '作成済み' else '未作成' end as 結果,
       '作成済み であれば正常' as 期待値

union all

select 'トリガー',
       case when exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal
           and c.relname = 'payroll_records'
           and t.tgname = 'guard_payroll_published'
       ) then '設定済み' else '未設定' end,
       '設定済み であれば正常'

union all

select '状態が食い違っている既存の行',
       count(*)::text || '件',
       '0件 であれば正常（1件以上あれば下の案内を参照）'
from public.payroll_records
where (status = 'draft' and published_at is not null)
   or (status = 'published' and published_at is null);


-- ⚠ 「状態が食い違っている既存の行」が1件以上あった場合
--
--   これまでの不具合で、公開日時だけ残って状態が下書きになっている明細です。
--   スタッフの画面には出ていませんが、公開した記録だけが残っています。
--   下のSQLで一覧を確認できます（読み取りのみ）。
--
--     select employee_id, year, month, status, published_at
--     from public.payroll_records
--     where (status = 'draft' and published_at is not null)
--        or (status = 'published' and published_at is null)
--     order by year, month;
--
--   どう揃えるか（下書きに寄せる／公開に戻す）は中身を見て判断する必要が
--   あるため、このファイルでは自動で直していません。
