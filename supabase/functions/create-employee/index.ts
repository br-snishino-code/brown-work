// supabase/functions/create-employee/index.ts
//
// 管理者だけが呼び出せる「社員アカウント作成」用Edge Function。
// service_role キーはこのサーバー側関数の中でのみ使用し、
// フロントエンド（Vercel/ブラウザ）には絶対に渡さない。
//
// デプロイ方法：
//   supabase functions deploy create-employee
//
// 必要なシークレット（フロントエンドの.envとは別に、Supabase側で設定）：
//   supabase secrets set SUPABASE_URL=https://xxxx.supabase.co
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxxxx
//   （SUPABASE_URL / SERVICE_ROLE_KEY は Supabase の Project Settings → API から取得）

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 呼び出し元のJWT（＝ログイン中の管理者のトークン）を取得
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: '認証情報がありません' }, 401);
    }

    // 呼び出し元が本当に管理者かどうかを、匿名クライアントではなく
    // ユーザーのJWTを使ったクライアントで検証する
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: '認証に失敗しました' }, 401);
    }

    const { data: callerEmployee, error: employeeError } = await callerClient
      .from('employees')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (employeeError || callerEmployee?.role !== 'admin') {
      return json({ error: '管理者のみアカウントを作成できます' }, 403);
    }

    const body = await req.json();
    const { username, password, name, hireDate } = body || {};
    if (!username || !password || !name) {
      return json({ error: 'username, password, name は必須です' }, 400);
    }
    if (String(password).length < 6) {
      return json({ error: 'パスワードは6文字以上にしてください' }, 400);
    }

    // service_role権限のクライアント（Auth Adminを操作するために必要）
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const email = `${username}@brownwork.local`;

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      const msg = createError?.message?.includes('already registered')
        ? 'そのユーザー名は既に使用されています'
        : createError?.message || 'アカウント作成に失敗しました';
      return json({ error: msg }, 400);
    }

    const { error: insertError } = await adminClient.from('employees').insert({
      id: created.user.id,
      username,
      name,
      role: 'employee',
      hire_date: hireDate || new Date().toISOString().slice(0, 10),
    });
    if (insertError) {
      // employees行の作成に失敗したら、作ってしまったAuthユーザーを削除してロールバック
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: `社員情報の登録に失敗しました: ${insertError.message}` }, 400);
    }

    return json({ ok: true, id: created.user.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '不明なエラーが発生しました' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
