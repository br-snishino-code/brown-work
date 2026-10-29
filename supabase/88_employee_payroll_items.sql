-- 88_employee_payroll_items.sql
--
-- 支給・控除項目を、スタッフごとにも設定できるようにする
--
-- いまの決まり方：
--   1. 全スタッフ共通（app_settings の payroll_items）
--   2. 給与規定グループごとの上書き（app_settings の payroll_item_groups）
--      ＝ メイングループ × スタッフ種別
--
--   グループでは合わない方がいても、1人だけ外すことができませんでした。
--   そこに3段目として「スタッフごとの上書き」を足します。
--
--   1 → 2 → 3 の順に重ね、あとのものが勝ちます。
--   触っていない項目は上の段のままなので、あとから項目を足したときも
--   自動でその方にも入ります。
--
-- なぜ app_settings ではなく専用の表にするか：
--   app_settings はログインした全員が読めます（27番）。
--   グループごとの設定は人が特定できないので問題ありませんが、
--   「誰が」「どの手当を」「いくら」が app_settings に入ると、
--   スタッフ全員から他人の賃金が読めてしまいます。
--   賃金は本人とマスター管理者だけが見られる決まりなので、
--   RLS を付けた専用の表に置きます。
--
-- 誰が見られるか：
--   読む  … ご本人とマスター管理者
--   書く  … マスター管理者のみ
--   管理者（admin）には見せません（賃金と同じ扱い）。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。


-- ========================================================
-- 1. スタッフごとの上書き
-- ========================================================
create table if not exists public.employee_payroll_item_overrides (
  -- 1人につき1行。中身は項目名をキーにした JSON です。
  employee_id uuid primary key references public.employees(id) on delete cascade,

  -- 形：{ "住宅手当": { "enabled": false }, "役割手当": { "amount": 30000 } }
  --   enabled … その方だけ使う／使わないを変える
  --   amount  … 金額の決め方が「決まった額」の項目だけ、額を変える
  -- 触っていない項目はこの JSON に入りません（上の段のままという意味）。
  overrides jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id),

  -- 配列や数値が入らないように（オブジェクトだけ）
  constraint employee_payroll_item_overrides_is_object
    check (jsonb_typeof(overrides) = 'object')
);

comment on table public.employee_payroll_item_overrides is
  '支給・控除項目のスタッフごとの上書き。全社共通→グループ→本人の順に重ねる';
comment on column public.employee_payroll_item_overrides.overrides is
  '{ 項目名: { enabled?: boolean, amount?: number } }。触っていない項目は入れない';


-- ========================================================
-- 2. 誰が見られるか
--    賃金と同じ扱い。管理者（admin）には見せません。
-- ========================================================
alter table public.employee_payroll_item_overrides enable row level security;

-- 読む：ご本人とマスター管理者
drop policy if exists "employee_payroll_item_overrides_select"
  on public.employee_payroll_item_overrides;
create policy "employee_payroll_item_overrides_select"
  on public.employee_payroll_item_overrides for select to authenticated
  using (employee_id = auth.uid() or public.is_master_admin());

-- 足す・直す・消す：マスター管理者のみ
drop policy if exists "employee_payroll_item_overrides_insert"
  on public.employee_payroll_item_overrides;
create policy "employee_payroll_item_overrides_insert"
  on public.employee_payroll_item_overrides for insert to authenticated
  with check (public.is_master_admin());

drop policy if exists "employee_payroll_item_overrides_update"
  on public.employee_payroll_item_overrides;
create policy "employee_payroll_item_overrides_update"
  on public.employee_payroll_item_overrides for update to authenticated
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "employee_payroll_item_overrides_delete"
  on public.employee_payroll_item_overrides;
create policy "employee_payroll_item_overrides_delete"
  on public.employee_payroll_item_overrides for delete to authenticated
  using (public.is_master_admin());

revoke all on public.employee_payroll_item_overrides from anon;
grant select, insert, update, delete
  on public.employee_payroll_item_overrides to authenticated;


-- ========================================================
-- 3. updated_at を自動で更新する
-- ========================================================
create or replace function public.touch_employee_payroll_items()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists touch_employee_payroll_items
  on public.employee_payroll_item_overrides;
create trigger touch_employee_payroll_items
  before update on public.employee_payroll_item_overrides
  for each row
  execute function public.touch_employee_payroll_items();

notify pgrst, 'reload schema';


-- ========================================================
-- 確認（このSQLを実行したあとで試せます）
-- ========================================================
-- ① 表ができているか
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'employee_payroll_item_overrides'
--    order by ordinal_position;
--   → 4行（employee_id / overrides / updated_at / updated_by）返れば作れています。
--
-- ② 権限が付いているか
--   select policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename = 'employee_payroll_item_overrides'
--    order by policyname;
--   → select / insert / update / delete の4つが返ります。
