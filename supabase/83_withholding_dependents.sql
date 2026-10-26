-- 83_withholding_dependents.sql
--
-- 所得税（源泉徴収）の自動計算に使う「扶養親族等の数」を持つ
--
-- 経緯：
--   扶養親族の人数は year_end_adjustments（年末調整）にしかありませんでした。
--   年末調整は年に1回の申告で、毎月の源泉徴収に使う数とは別物です。
--   毎月の給与計算で使えるよう、専用の表を作ります。
--
-- なぜ employees に列を足さないか：
--   扶養の情報（spouse_status / family_members / disability_classification など）は
--   71a・73b で「本人とマスター管理者以外には見えない列」に入っています。
--   employees に足すと、その一覧に加える（＝一般の管理者から見えなくなる）か、
--   外す（＝扶養の情報が一般の管理者に見えるようになる）かの二択になります。
--   住民税（80番）・標準報酬月額（60番）と同じく別表にして、
--   表ごとの権限で扱いを揃えます。
--
-- 年月で持つ理由：
--   扶養親族等の数は年の途中で変わります（出生・就職・扶養から外れる など）。
--   標準報酬月額（employee_standard_remuneration）と同じく (年, 月) で持ち、
--   給与計算では「その月以前で最新の登録」を使います。
--   過去の明細を作り直しても、当時の数で計算されます。
--
-- 入れる数：
--   源泉徴収税額表でいう「扶養親族等の数」です。
--   扶養控除等申告書をもとに、次を足した数を入れてください。
--     ・源泉控除対象配偶者                                    …… いれば 1
--     ・源泉控除対象扶養親族の人数                            …… その人数
--     ・本人が障害者・寡婦・ひとり親・勤労学生に当たるとき     …… 各 1
--     ・扶養親族等が障害者のとき                              …… 1
--       （同居特別障害者のときは 2）
--   ジョブカンに入れている数と同じものです。
--   ⚠ この数の作り方は税額に直結します。自動では出せないため、
--     扶養控除等申告書を見て入れてください。
--
-- ⚠ この表を入れただけでは所得税は計算されません。
--   アプリ側の対応とあわせて動きます（同じ回で出します）。
--
-- 何度流しても同じ結果になります（2回目以降は何も起きません）。
--
-- ※ Supabase の SQL Editor にそのまま貼り付けて実行できます。


-- ========================================================
-- 1. 扶養親族等の数の表
-- ========================================================
create table if not exists public.employee_withholding_dependents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- いつの分から使う数か（この年月以降、次の登録が出るまで使われます）
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),

  -- 扶養親族等の数
  dependents integer not null default 0
    check (dependents >= 0 and dependents <= 20),

  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,

  unique (employee_id, year, month)
);

comment on table public.employee_withholding_dependents is
  '源泉徴収税額表でいう扶養親族等の数。配偶者・扶養親族・障害者等の加算を含む。'
  '(年, 月) ごとに持ち、給与計算ではその月以前で最新の登録を使う。年末調整の扶養人数とは別。';
comment on column public.employee_withholding_dependents.dependents is
  '源泉控除対象配偶者＋源泉控除対象扶養親族＋障害者等の加算を合計した数。扶養控除等申告書をもとに入力する。';


-- ========================================================
-- 2. 権限（給与と同じ重さの情報として扱う）
-- ========================================================
-- 読む：本人と、マスター管理者だけ。
-- 書く：マスター管理者だけ。
-- 住民税・標準報酬月額・給与明細（72番・78番・80番）と同じ扱いに揃えています。
alter table public.employee_withholding_dependents enable row level security;

drop policy if exists "employee_withholding_dependents_select" on public.employee_withholding_dependents;
create policy "employee_withholding_dependents_select"
  on public.employee_withholding_dependents for select to authenticated
  using (employee_id = auth.uid() or public.is_master_admin());

drop policy if exists "employee_withholding_dependents_insert" on public.employee_withholding_dependents;
create policy "employee_withholding_dependents_insert"
  on public.employee_withholding_dependents for insert to authenticated
  with check (public.is_master_admin());

drop policy if exists "employee_withholding_dependents_update" on public.employee_withholding_dependents;
create policy "employee_withholding_dependents_update"
  on public.employee_withholding_dependents for update to authenticated
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "employee_withholding_dependents_delete" on public.employee_withholding_dependents;
create policy "employee_withholding_dependents_delete"
  on public.employee_withholding_dependents for delete to authenticated
  using (public.is_master_admin());

-- ログインしていない人には表の権限そのものを渡しません（55番と同じ扱い）
revoke all on public.employee_withholding_dependents from anon;
grant select, insert, update, delete on public.employee_withholding_dependents to authenticated;

create index if not exists employee_withholding_dependents_employee_idx
  on public.employee_withholding_dependents (employee_id, year, month);


-- ========================================================
-- 3. 確認クエリ（まとめて1回で見られます）
-- ========================================================
select '① 表ができているか（1なら成功）' as "確認項目",
       (select count(*)::text from information_schema.tables
        where table_schema = 'public' and table_name = 'employee_withholding_dependents') as "結果"
union all
select '② ポリシーの数（4なら成功）',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'employee_withholding_dependents')
union all
select '③ ログインしていない人の権限（0なら成功）',
       (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'employee_withholding_dependents'
          and grantee = 'anon')
union all
select '④ 甲欄の在籍者（所得税を自動計算する人数）',
       (select count(*)::text from public.employees
        where resignation_date is null
          and coalesce(nullif(tax_table_type, ''), '甲欄') = '甲欄'
          and coalesce(is_non_resident, false) = false)
union all
select '⑤ 乙欄・非居住者の在籍者（手入力のままになる人数）',
       (select count(*)::text from public.employees
        where resignation_date is null
          and (coalesce(nullif(tax_table_type, ''), '甲欄') <> '甲欄'
               or coalesce(is_non_resident, false) = true));


-- ========================================================
-- 4. 扶養親族等の数の登録が必要な方（在籍中の甲欄の方）
-- ========================================================
-- 扶養がいない方も 0 で登録してください。
-- 登録が無い方は、所得税が自動計算されず手入力のままになります。
select e.name as "氏名",
       coalesce(nullif(e.tax_table_type, ''), '甲欄') as "税額表",
       coalesce(d.dependents::text, '未登録') as "扶養親族等の数"
from public.employees e
left join public.employee_withholding_dependents d on d.employee_id = e.id
where e.resignation_date is null
  and coalesce(nullif(e.tax_table_type, ''), '甲欄') = '甲欄'
  and coalesce(e.is_non_resident, false) = false
order by e.name;
