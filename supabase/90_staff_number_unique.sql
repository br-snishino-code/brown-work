-- 90_staff_number_unique.sql
--
-- スタッフコードでログインできるようにするための下ごしらえ
--
-- スタッフコード（employees.staff_number）はこれまで「ただのメモ欄」でした。
-- 重複しても空でも登録できます。
-- ログインIDとして使うには、1つのコードが1人に決まる必要があります。
-- 同じコードの方が2人いると、どちらの方としてログインさせるか決められません。
--
-- このSQLでやること：
--   コードが重複して登録されないよう、一意のインデックスを付けます。
--   ・大文字小文字は区別しません（b001 と B001 は同じコードとして扱います）
--   ・前後の空白は無視します
--   ・空欄は対象外です（コードを付けない方が何人いても構いません）
--   ・退職された方も含めて重複を禁じます
--     （退職後に同じコードを使い回すと、過去の帳簿と突き合わせられなくなるためです）
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- ⚠ すでに重複したコードが登録されていると、このSQLは失敗します。
--   失敗した場合は、下の「確認」①で重複を調べ、直してから流し直してください。
--   実行前の時点で御社のコードは全員未登録のため、通常は失敗しません。

begin;

-- ------------------------------------------------------------
-- スタッフコードの重複を禁じる
--   lower(trim(...)) で比べるので、大文字小文字と前後の空白の違いは
--   同じコードとみなされます。
--   where 句があるため、空欄（null や空文字）は何件でも許されます。
-- ------------------------------------------------------------
create unique index if not exists employees_staff_number_unique
  on public.employees (lower(trim(staff_number)))
  where coalesce(trim(staff_number), '') <> '';

comment on column public.employees.staff_number is
  'スタッフコード。ログインIDとしても使う。大文字小文字と前後の空白を無視して一意。空欄可';

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 確認（このSQLを実行したあとで試せます）
-- ============================================================
-- ① 重複が無いか（0行なら重複なし）
--   select lower(trim(staff_number)) as コード, count(*) as 件数
--     from public.employees
--    where coalesce(trim(staff_number), '') <> ''
--    group by 1
--   having count(*) > 1;
--
-- ② インデックスができているか
--   select indexname from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'employees'
--      and indexname = 'employees_staff_number_unique';
--   → 1行返れば付いています。
--
-- ③ 重複を本当に止められるか（試したあとは必ず元に戻してください）
--   -- 誰か1人にコードを付ける
--   -- update public.employees set staff_number = 'TEST001' where id = '（対象のid）';
--   -- 別の人に小文字で同じコードを付けようとする → エラーになれば正しく効いています
--   -- update public.employees set staff_number = 'test001' where id = '（別の人のid）';
--   -- 戻す
--   -- update public.employees set staff_number = null where staff_number ilike 'test001';
