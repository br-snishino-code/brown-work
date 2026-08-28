/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// CLOUD_ENABLEDがfalseのときも呼び出し側が落ちないよう、
// 値が無い場合はダミーURLでクライアントだけ作っておく（実際には使われない）
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // パスワード再設定メールのリンク（URLに認証トークンが付く）を検出するため true にする
      detectSessionInUrl: true,
    },
  }
);

// ユーザー名は社内ログイン用の見た目のIDだが、Supabase Authはメール形式が必要なため、
// 内部的には "username@brownwork.local" という擬似メールアドレスに変換して使う。
// ただし、最初から "@" を含む本物のメールアドレスが入力された場合は、
// そのままメールアドレスとしてSupabase Authに渡す（二重変換を防ぐため）。
export const usernameToEmail = (username: string) => {
  const trimmed = username.trim();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@brownwork.local`;
};
