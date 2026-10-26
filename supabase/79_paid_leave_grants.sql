-- 79_paid_leave_grants.sql
--
-- 有休を「付与レコード」で管理できるようにする（繰越・2年時効・繰越分優先の消化）
--
-- 直す問題：
--   いまの残日数は「その時点の勤続年数に対応する1年分の付与日数」から
--   「入社以来の承認済み有休の合計」を引いていました。分母と分子の単位が
--   揃っていないため、勤続1年を超えたスタッフの残日数が実態より少なく出ます。
--
--   実例（2023年4月入社・毎年ちょうど付与分を消化・2026年10月26日時点）：
--     分母（1年分の付与）＝14日／分子（入社以来の消化）＝33日 → 残 −19日
--
--   残日数がマイナスになると、休暇申請の送信ボタンが押せなくなり、
--   そのスタッフは有休を一切申請できなくなります。
--   スタッフ一覧は 0 に丸めて表示するため、管理者には「残0日」と見えます。
--
-- 決めたこと（就業規則にあわせて確認済み）：
--   ・未消化分は翌年度に繰り越す
--   ・時効は2年（付与日から2年で消滅）。保有は最大40日
--   ・消化は繰越分（古い付与）から先に充てる
--   ・ジョブカンの残日数は引き継ぐ
--
-- この表が持つのは「法定どおりに導けない付与」だけです：
--   ・ジョブカンからの引き継ぎ（carryover）
--   ・手で足す／直す分（manual）
--   法定の付与（勤続6ヶ月で10日→以降1年ごと、比例付与を含む）は
--   入職日から画面側で導きます。表にその付与日の行があれば、そちらで上書きします。
--
--   「どこから引き継ぐか」の境目は app_settings の paid_leave_migration_date です。
--   この日より前の付与と、この日より前の有休の消化は、どちらも計算に入れません
--   （引き継いだ残日数にすでに含まれているため、二重に数えないようにしています）。
--
-- ⚠ 実行したあとに必要な作業
--   1. 移行日を決めて app_settings に入れる（下の「3.」で入れています。日付を変えてください）
--   2. スタッフごとに引き継ぐ残日数を登録する（画面から入れられます）
--   3. いま「有休の手動調整」に入っている値を確認する（下の確認クエリ④）
--      引き継ぎを登録したら、二重に足さないよう手動調整は0に戻してください
--
-- 何度流しても同じ結果になります（2回目以降は何も起きません）。
--
-- ※ Supabase の SQL Editor にそのまま貼り付けて実行できます。
--    （psql 専用の記法は使っていません）


-- ========================================================
-- 1. 付与レコードの表
-- ========================================================
create table if not exists public.employee_leave_grants (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- 付与日。時効日はこの日から2年後（その前日まで有効）として画面側で計算します。
  -- 繰越分を引き継ぐときは「もとの付与日」を入れてください。
  -- そうしないと時効の判定がずれます。
  grant_date date not null,

  -- 付与日数。半日単位があるため numeric です。
  days numeric not null check (days > 0 and days <= 40),

  -- carryover ＝ ジョブカンからの引き継ぎ
  -- manual    ＝ 手で足す／法定の付与を直す
  kind text not null check (kind in ('carryover', 'manual')),

  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,

  -- 同じ日に2件入れられないようにします。
  -- 同じ日に足したい場合は日数を合算して1件にしてください。
  unique (employee_id, grant_date)
);

comment on table public.employee_leave_grants is
  '有休の付与レコード。法定どおりに導けない付与（引き継ぎ・手動）だけを持つ。法定付与は入職日から画面側で導く。';
comment on column public.employee_leave_grants.grant_date is
  '付与日。時効日はこの日から2年後（前日まで有効）。繰越分の引き継ぎでは「もとの付与日」を入れる。';


-- ========================================================
-- 2. 権限（スタッフは自分の分を見るだけ。登録は管理者以上）
-- ========================================================
alter table public.employee_leave_grants enable row level security;

-- 読む：本人と管理者
drop policy if exists "employee_leave_grants_select" on public.employee_leave_grants;
create policy "employee_leave_grants_select"
  on public.employee_leave_grants for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- 足す・直す・消す：管理者以上だけ
-- （有休の残日数は賃金と同じ重さの情報なので、本人には触らせません。
--   「有休の手動調整」が本人では変更できない列になっているのと同じ扱いです）
drop policy if exists "employee_leave_grants_insert" on public.employee_leave_grants;
create policy "employee_leave_grants_insert"
  on public.employee_leave_grants for insert to authenticated
  with check (public.is_admin());

drop policy if exists "employee_leave_grants_update" on public.employee_leave_grants;
create policy "employee_leave_grants_update"
  on public.employee_leave_grants for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "employee_leave_grants_delete" on public.employee_leave_grants;
create policy "employee_leave_grants_delete"
  on public.employee_leave_grants for delete to authenticated
  using (public.is_admin());

-- ログインしていない人（anon）には表の権限そのものを渡しません。
-- 上のポリシーで行は守られますが、55番と同じく権限も合わせて外しておきます。
-- authenticated に渡す DML はポリシーで管理者だけに絞られます。
revoke all on public.employee_leave_grants from anon;
grant select, insert, update, delete on public.employee_leave_grants to authenticated;

-- 引くときに使う索引
create index if not exists employee_leave_grants_employee_idx
  on public.employee_leave_grants (employee_id, grant_date);


-- ========================================================
-- 3. 移行日（この日より前は引き継いだ残日数に含まれているものとして扱う）
-- ========================================================
-- ⚠ 日付を御社の移行日に変えてください。
--   この日より前の有休の消化は残日数の計算に入りません。
--   まだ入れていない場合、すでに入っている値は上書きしません。
insert into public.app_settings (key, value)
values ('paid_leave_migration_date', '2026-11-01')
on conflict (key) do nothing;


-- ========================================================
-- 4. 確認クエリ（実行後にそれぞれ流して結果を見てください）
-- ========================================================

-- ① 表ができているか（1 なら成功）
select count(*) as "表ができているか（1なら成功）"
from information_schema.tables
where table_schema = 'public' and table_name = 'employee_leave_grants';

-- ② 権限がかかっているか（4 なら成功）
select count(*) as "ポリシーの数（4なら成功）"
from pg_policies
where schemaname = 'public' and tablename = 'employee_leave_grants';

-- ③ 移行日（1行出れば成功）
select key, value as "移行日"
from public.app_settings
where key = 'paid_leave_migration_date';

-- ④ いま「有休の手動調整」に値が入っているスタッフ
--    引き継ぎを登録したあと、ここが0以外のままだと二重に足されます。
select e.name as "氏名", e.leave_adjustment as "手動調整（日）", e.hire_date as "入職日"
from public.employees e
where coalesce(e.leave_adjustment, 0) <> 0
  and e.resignation_date is null
order by e.name;

-- ⑤ 在籍中で入職から6ヶ月以上たっているスタッフ（引き継ぎの登録が必要な人）
select
  e.name as "氏名",
  e.hire_date as "入職日",
  e.staff_type as "種別",
  e.scheduled_weekly_days as "週の所定労働日数"
from public.employees e
where e.resignation_date is null
  and e.hire_date is not null
  and e.hire_date <= current_date - interval '6 months'
order by e.hire_date;
