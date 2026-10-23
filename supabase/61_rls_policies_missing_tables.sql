-- 61_rls_policies_missing_tables.sql
--
-- 60番で作る17テーブルのアクセス制限（RLSポリシー）
--
-- 経緯：
--   60番は表の形（列・制約）だけを作ります。アクセス制限が無いと、
--   「RLSは有効だがポリシーが1つも無い」状態になり、
--   情報は漏れませんがアプリがまったく動きません。
--   このファイルで、本番と同じ制限を入れ直します。
--
-- 出どころ：
--   59c_export_policies.sql の結果（2026年10月23日時点の本番）
--   67個のポリシー（通常57個 ＋ 全体制限10個）をそのまま起こしています。
--
-- 使う順番：
--   1. 01_schema.sql など既存のSQL（employees 表と is_admin() が必要）
--   2. 50_mfa_enforcement.sql（mfa_ok()）
--   3. 51_self_approval_guard.sql（caller_is_admin()）
--   4. 54_admin_tab_permission.sql（has_admin_tab()）
--   5. 60_schema_missing_tables.sql（表を作る）
--   6. このファイル
--
--   先に関数が無いと「function ... does not exist」で止まります。
--
-- 何度流しても同じ結果になります（drop policy if exists → create policy）。
--
-- 用語：
--   「全体制限」（RESTRICTIVE）… 他のポリシーと AND で効く追い鍵。
--     例：給与明細は「本人か管理者」かつ「2段階認証済み」かつ
--         「給与タブの権限あり」の3つを満たさないと触れません。
--   「読める条件」（using）     … 既にある行に触れるかどうかの判定
--   「書ける条件」（with check）… これから入る値を許すかどうかの判定


-- ========================================================
-- announcements … 社内のお知らせ
-- ========================================================
alter table public.announcements enable row level security;

drop policy if exists "announcements admin delete" on public.announcements;
create policy "announcements admin delete" on public.announcements
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "announcements admin insert" on public.announcements;
create policy "announcements admin insert" on public.announcements
  as permissive
  for insert
  to authenticated
  with check (is_admin());

drop policy if exists "announcements admin update" on public.announcements;
create policy "announcements admin update" on public.announcements
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "announcements select all authenticated" on public.announcements;
create policy "announcements select all authenticated" on public.announcements
  as permissive
  for select
  to authenticated
  using (true);


-- ========================================================
-- audit_logs … 操作の履歴（監査ログ）
-- ========================================================
alter table public.audit_logs enable row level security;

drop policy if exists "mfa required" on public.audit_logs;
create policy "mfa required" on public.audit_logs
  as restrictive
  for all
  to authenticated
  using (mfa_ok())
  with check (mfa_ok());

drop policy if exists "audit insert admin only" on public.audit_logs;
create policy "audit insert admin only" on public.audit_logs
  as permissive
  for insert
  to authenticated
  with check (is_admin());

drop policy if exists "audit select admin only" on public.audit_logs;
create policy "audit select admin only" on public.audit_logs
  as permissive
  for select
  to authenticated
  using (is_admin());


-- ========================================================
-- commute_expense_claims … 交通費精算の申請
-- ========================================================
alter table public.commute_expense_claims enable row level security;

drop policy if exists "mfa required" on public.commute_expense_claims;
create policy "mfa required" on public.commute_expense_claims
  as restrictive
  for all
  to authenticated
  using (mfa_ok())
  with check (mfa_ok());

drop policy if exists "payroll tab required" on public.commute_expense_claims;
create policy "payroll tab required" on public.commute_expense_claims
  as restrictive
  for all
  to authenticated
  using (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)))
  with check (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)));

drop policy if exists "commute_expense_claims_delete" on public.commute_expense_claims;
create policy "commute_expense_claims_delete" on public.commute_expense_claims
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "commute_expense_claims_insert" on public.commute_expense_claims;
create policy "commute_expense_claims_insert" on public.commute_expense_claims
  as permissive
  for insert
  to authenticated
  with check (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "commute_expense_claims_select" on public.commute_expense_claims;
create policy "commute_expense_claims_select" on public.commute_expense_claims
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "commute_expense_claims_update" on public.commute_expense_claims;
create policy "commute_expense_claims_update" on public.commute_expense_claims
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1 FROM employees e WHERE ((e.id = auth.uid()) AND (e.role = 'master_admin'::text)))))
  with check (true);

drop policy if exists "own commute claim update" on public.commute_expense_claims;
create policy "own commute claim update" on public.commute_expense_claims
  as permissive
  for update
  to authenticated
  using (((employee_id = auth.uid()) AND (status <> 'approved'::text)))
  with check ((employee_id = auth.uid()));


-- ========================================================
-- employee_attendance_schedules … スタッフ個別の出勤規定日数（月別）
-- ========================================================
alter table public.employee_attendance_schedules enable row level security;

drop policy if exists "employee_attendance_schedules_delete" on public.employee_attendance_schedules;
create policy "employee_attendance_schedules_delete" on public.employee_attendance_schedules
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "employee_attendance_schedules_insert" on public.employee_attendance_schedules;
create policy "employee_attendance_schedules_insert" on public.employee_attendance_schedules
  as permissive
  for insert
  to authenticated
  with check (is_admin());

drop policy if exists "employee_attendance_schedules_select" on public.employee_attendance_schedules;
create policy "employee_attendance_schedules_select" on public.employee_attendance_schedules
  as permissive
  for select
  to authenticated
  using (true);

drop policy if exists "employee_attendance_schedules_update" on public.employee_attendance_schedules;
create policy "employee_attendance_schedules_update" on public.employee_attendance_schedules
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());


-- ========================================================
-- employee_commute_routes … 通勤経路（定期代・片道運賃）
-- ========================================================
alter table public.employee_commute_routes enable row level security;

drop policy if exists "employee_commute_routes_all" on public.employee_commute_routes;
create policy "employee_commute_routes_all" on public.employee_commute_routes
  as permissive
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "employee_commute_routes_select_own" on public.employee_commute_routes;
create policy "employee_commute_routes_select_own" on public.employee_commute_routes
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));


-- ========================================================
-- employee_salary_items … 毎月の固定支給・固定控除
-- ========================================================
alter table public.employee_salary_items enable row level security;

drop policy if exists "mfa required" on public.employee_salary_items;
create policy "mfa required" on public.employee_salary_items
  as restrictive
  for all
  to authenticated
  using (mfa_ok())
  with check (mfa_ok());

drop policy if exists "payroll tab required" on public.employee_salary_items;
create policy "payroll tab required" on public.employee_salary_items
  as restrictive
  for all
  to authenticated
  using (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)))
  with check (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)));

drop policy if exists "employee_salary_items_all" on public.employee_salary_items;
create policy "employee_salary_items_all" on public.employee_salary_items
  as permissive
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "employee_salary_items_select_own" on public.employee_salary_items;
create policy "employee_salary_items_select_own" on public.employee_salary_items
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));


-- ========================================================
-- employee_schedule_patterns … 規定勤怠時間のパターン（月別）
-- ========================================================
alter table public.employee_schedule_patterns enable row level security;

drop policy if exists "employee_schedule_patterns_delete" on public.employee_schedule_patterns;
create policy "employee_schedule_patterns_delete" on public.employee_schedule_patterns
  as permissive
  for delete
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "employee_schedule_patterns_insert" on public.employee_schedule_patterns;
create policy "employee_schedule_patterns_insert" on public.employee_schedule_patterns
  as permissive
  for insert
  to authenticated
  with check (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "employee_schedule_patterns_select" on public.employee_schedule_patterns;
create policy "employee_schedule_patterns_select" on public.employee_schedule_patterns
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "employee_schedule_patterns_update" on public.employee_schedule_patterns;
create policy "employee_schedule_patterns_update" on public.employee_schedule_patterns
  as permissive
  for update
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()))
  with check (((employee_id = auth.uid()) OR is_admin()));


-- ========================================================
-- employee_standard_remuneration … 標準報酬月額と保険料の記録（月別）
-- ========================================================
alter table public.employee_standard_remuneration enable row level security;

drop policy if exists "mfa required" on public.employee_standard_remuneration;
create policy "mfa required" on public.employee_standard_remuneration
  as restrictive
  for all
  to authenticated
  using (mfa_ok())
  with check (mfa_ok());

drop policy if exists "payroll tab required" on public.employee_standard_remuneration;
create policy "payroll tab required" on public.employee_standard_remuneration
  as restrictive
  for all
  to authenticated
  using (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)))
  with check (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)));

drop policy if exists "employee_standard_remuneration_all" on public.employee_standard_remuneration;
create policy "employee_standard_remuneration_all" on public.employee_standard_remuneration
  as permissive
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "employee_standard_remuneration_select_own" on public.employee_standard_remuneration;
create policy "employee_standard_remuneration_select_own" on public.employee_standard_remuneration
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));


-- ========================================================
-- group_attendance_schedules … グループ別の出勤規定日数（月別）
-- ========================================================
alter table public.group_attendance_schedules enable row level security;

drop policy if exists "group leave admin delete" on public.group_attendance_schedules;
create policy "group leave admin delete" on public.group_attendance_schedules
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "group leave admin update" on public.group_attendance_schedules;
create policy "group leave admin update" on public.group_attendance_schedules
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "group leave admin write" on public.group_attendance_schedules;
create policy "group leave admin write" on public.group_attendance_schedules
  as permissive
  for insert
  to authenticated
  with check (is_admin());

drop policy if exists "group leave select all authenticated" on public.group_attendance_schedules;
create policy "group leave select all authenticated" on public.group_attendance_schedules
  as permissive
  for select
  to authenticated
  using (true);


-- ========================================================
-- group_incentive_flags … インセンティブの目標達成フラグ（業務・月別）
-- ========================================================
alter table public.group_incentive_flags enable row level security;

drop policy if exists "group_incentive_flags_delete" on public.group_incentive_flags;
create policy "group_incentive_flags_delete" on public.group_incentive_flags
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "group_incentive_flags_insert" on public.group_incentive_flags;
create policy "group_incentive_flags_insert" on public.group_incentive_flags
  as permissive
  for insert
  to authenticated
  with check (is_admin());

drop policy if exists "group_incentive_flags_select" on public.group_incentive_flags;
create policy "group_incentive_flags_select" on public.group_incentive_flags
  as permissive
  for select
  to authenticated
  using (true);

drop policy if exists "group_incentive_flags_update" on public.group_incentive_flags;
create policy "group_incentive_flags_update" on public.group_incentive_flags
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());


-- ========================================================
-- insurance_rate_settings … 保険料率の設定（全社で1行）
-- ========================================================
alter table public.insurance_rate_settings enable row level security;

drop policy if exists "insurance_rate_settings_select" on public.insurance_rate_settings;
create policy "insurance_rate_settings_select" on public.insurance_rate_settings
  as permissive
  for select
  to authenticated
  using (true);

drop policy if exists "insurance_rate_settings_update" on public.insurance_rate_settings;
create policy "insurance_rate_settings_update" on public.insurance_rate_settings
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "insurance_rate_settings_upsert" on public.insurance_rate_settings;
create policy "insurance_rate_settings_upsert" on public.insurance_rate_settings
  as permissive
  for insert
  to authenticated
  with check (is_admin());


-- ========================================================
-- payroll_records … 給与明細
-- ========================================================
alter table public.payroll_records enable row level security;

drop policy if exists "mfa required" on public.payroll_records;
create policy "mfa required" on public.payroll_records
  as restrictive
  for all
  to authenticated
  using (mfa_ok())
  with check (mfa_ok());

drop policy if exists "payroll tab required" on public.payroll_records;
create policy "payroll tab required" on public.payroll_records
  as restrictive
  for all
  to authenticated
  using (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)))
  with check (((employee_id = auth.uid()) OR has_admin_tab('payroll'::text)));

drop policy if exists "payroll admin delete" on public.payroll_records;
create policy "payroll admin delete" on public.payroll_records
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "payroll admin insert" on public.payroll_records;
create policy "payroll admin insert" on public.payroll_records
  as permissive
  for insert
  to authenticated
  with check (is_admin());

drop policy if exists "payroll admin update" on public.payroll_records;
create policy "payroll admin update" on public.payroll_records
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "payroll select own published or admin" on public.payroll_records;
create policy "payroll select own published or admin" on public.payroll_records
  as permissive
  for select
  to authenticated
  using ((((employee_id = auth.uid()) AND (status = 'published'::text)) OR is_admin()));


-- ========================================================
-- profile_update_requests … 登録情報の変更申請
-- ========================================================
alter table public.profile_update_requests enable row level security;

drop policy if exists "profile req insert own" on public.profile_update_requests;
create policy "profile req insert own" on public.profile_update_requests
  as permissive
  for insert
  to authenticated
  with check ((employee_id = auth.uid()));

drop policy if exists "profile req select own or admin" on public.profile_update_requests;
create policy "profile req select own or admin" on public.profile_update_requests
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "profile req update admin only" on public.profile_update_requests;
create policy "profile req update admin only" on public.profile_update_requests
  as permissive
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());


-- ========================================================
-- resignation_reasons … 退職理由の選択肢
-- ========================================================
alter table public.resignation_reasons enable row level security;

drop policy if exists "resignation_reasons_admin_write" on public.resignation_reasons;
create policy "resignation_reasons_admin_write" on public.resignation_reasons
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1 FROM employees e WHERE ((e.id = auth.uid()) AND (e.role = ANY (ARRAY['admin'::text, 'master_admin'::text]))))))
  with check ((EXISTS ( SELECT 1 FROM employees e WHERE ((e.id = auth.uid()) AND (e.role = ANY (ARRAY['admin'::text, 'master_admin'::text]))))));

drop policy if exists "resignation_reasons_select" on public.resignation_reasons;
create policy "resignation_reasons_select" on public.resignation_reasons
  as permissive
  for select
  to authenticated
  using (true);


-- ========================================================
-- staff_existing_performance … eo業務の既存実績（アップセルLTV）
-- ========================================================
alter table public.staff_existing_performance enable row level security;

drop policy if exists "本人と管理者が作れる" on public.staff_existing_performance;
create policy "本人と管理者が作れる" on public.staff_existing_performance
  as permissive
  for insert
  to authenticated
  with check (((employee_id = auth.uid()) OR caller_is_admin()));

drop policy if exists "本人と管理者が直せる" on public.staff_existing_performance;
create policy "本人と管理者が直せる" on public.staff_existing_performance
  as permissive
  for update
  to authenticated
  using (((employee_id = auth.uid()) OR caller_is_admin()))
  with check (((employee_id = auth.uid()) OR caller_is_admin()));

drop policy if exists "本人と管理者が読める" on public.staff_existing_performance;
create policy "本人と管理者が読める" on public.staff_existing_performance
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR caller_is_admin()));

drop policy if exists "管理者だけが消せる" on public.staff_existing_performance;
create policy "管理者だけが消せる" on public.staff_existing_performance
  as permissive
  for delete
  to authenticated
  using (caller_is_admin());


-- ========================================================
-- staff_new_performance … eo業務の新規実績
-- ========================================================
alter table public.staff_new_performance enable row level security;

drop policy if exists "本人と管理者が作れる" on public.staff_new_performance;
create policy "本人と管理者が作れる" on public.staff_new_performance
  as permissive
  for insert
  to authenticated
  with check (((employee_id = auth.uid()) OR caller_is_admin()));

drop policy if exists "本人と管理者が直せる" on public.staff_new_performance;
create policy "本人と管理者が直せる" on public.staff_new_performance
  as permissive
  for update
  to authenticated
  using (((employee_id = auth.uid()) OR caller_is_admin()))
  with check (((employee_id = auth.uid()) OR caller_is_admin()));

drop policy if exists "本人と管理者が読める" on public.staff_new_performance;
create policy "本人と管理者が読める" on public.staff_new_performance
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR caller_is_admin()));

drop policy if exists "管理者だけが消せる" on public.staff_new_performance;
create policy "管理者だけが消せる" on public.staff_new_performance
  as permissive
  for delete
  to authenticated
  using (caller_is_admin());


-- ========================================================
-- year_end_adjustments … 年末調整の申告内容
-- ========================================================
alter table public.year_end_adjustments enable row level security;

drop policy if exists "mfa required" on public.year_end_adjustments;
create policy "mfa required" on public.year_end_adjustments
  as restrictive
  for all
  to authenticated
  using (mfa_ok())
  with check (mfa_ok());

drop policy if exists "year_end_adjustments_delete" on public.year_end_adjustments;
create policy "year_end_adjustments_delete" on public.year_end_adjustments
  as permissive
  for delete
  to authenticated
  using (is_admin());

drop policy if exists "year_end_adjustments_insert" on public.year_end_adjustments;
create policy "year_end_adjustments_insert" on public.year_end_adjustments
  as permissive
  for insert
  to authenticated
  with check (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "year_end_adjustments_select" on public.year_end_adjustments;
create policy "year_end_adjustments_select" on public.year_end_adjustments
  as permissive
  for select
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()));

drop policy if exists "year_end_adjustments_update" on public.year_end_adjustments;
create policy "year_end_adjustments_update" on public.year_end_adjustments
  as permissive
  for update
  to authenticated
  using (((employee_id = auth.uid()) OR is_admin()))
  with check (((employee_id = auth.uid()) OR is_admin()));

notify pgrst, 'reload schema';

-- ========================================================
-- 確認
-- ========================================================
select 'ポリシーの数' as 確認項目,
       count(*)::text || '／67' as 結果,
       '67／67 であれば本番と同じ' as 期待値
from pg_policies
where schemaname = 'public' and tablename in ('announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules', 'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns', 'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags', 'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons', 'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments')

union all

select '全体制限（RESTRICTIVE）の数',
       count(*)::text || '／10',
       '10／10 であれば正常'
from pg_policies
where schemaname = 'public' and tablename in ('announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules', 'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns', 'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags', 'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons', 'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments')
  and permissive = 'RESTRICTIVE'

union all

select 'ポリシーが無い表',
       coalesce(string_agg(t.table_name, ', '), 'なし'),
       'なし であれば正常'
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_name in ('announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules', 'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns', 'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags', 'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons', 'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments')
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.table_name
  );
