-- ============================================================
-- 20. アカウント作成フローの改善
--     （初回ログイン時のパスワード変更必須／個人情報入力の案内）
-- ============================================================
-- 実行方法：Supabase の SQL Editor に貼り付けて Run
-- 何度実行しても安全です（IF NOT EXISTS）
-- ============================================================

alter table public.employees
  -- 初回ログイン時にパスワードの変更を求めるかどうか
  add column if not exists must_change_password boolean not null default false,
  -- 個人情報（住所・連絡先など）の初回入力が済んでいるかどうか
  add column if not exists profile_setup_completed boolean not null default true,
  -- 招待メールを送った日時（未送信なら null）
  add column if not exists invited_at timestamptz;

comment on column public.employees.must_change_password is '初回ログイン時にパスワード変更を必須にする';
comment on column public.employees.profile_setup_completed is '個人情報の初回入力が完了しているか';
comment on column public.employees.invited_at is '招待メールの送信日時';

-- 既存のスタッフは対象外（すでに利用中のため）
update public.employees
   set must_change_password = false,
       profile_setup_completed = true
 where must_change_password is null
    or profile_setup_completed is null;

-- 確認用
-- select name, must_change_password, profile_setup_completed, invited_at from public.employees order by name;
