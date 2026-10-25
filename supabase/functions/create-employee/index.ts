// supabase/functions/create-employee/index.ts
//
// マスター管理者だけが呼び出せる「アカウント作成」用Edge Function。
// service_role キーはこのサーバー側関数の中でのみ使用し、
// フロントエンド（Vercel/ブラウザ）には絶対に渡さない。
//
// デプロイ方法：
//   supabase functions deploy create-employee
//
// 必要なシークレット（フロントエンドの.envとは別に、Supabase側で設定）：
//   supabase secrets set SUPABASE_URL=https://xxxx.supabase.co
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxxxx
//   （Supabase の Project Settings → API から取得）

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 呼び出し元のJWT（＝ログイン中のマスター管理者のトークン）を取得
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: '認証情報がありません' }, 401);
    }

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: '認証に失敗しました' }, 401);
    }

    // service_role権限のクライアント（Auth Adminを操作するために必要）
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // アカウントを作成できるのはマスター管理者のみ
    const { data: caller, error: callerError } = await adminClient
      .from('employees')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (callerError || caller?.role !== 'master_admin') {
      return json({ error: 'アカウントを作成できるのはマスター管理者のみです' }, 403);
    }

    const body = await req.json();
    const { username, password, name, furigana, hireDate, role, adminPermissions, contactEmail } = body || {};
    if (!username || !password || !name) {
      return json({ error: 'username, password, name は必須です' }, 400);
    }
    // パスワードの決まり。Supabase側の設定（Authentication のパスワード設定）と
    // 画面側（src/App.tsx の passwordProblem）と、三者を揃えること。
    //   最低文字数：8 ／ 必要な文字：数字・英大文字・英小文字
    const pw = String(password);
    if (pw.length < 8) {
      return json({ error: 'パスワードは8文字以上にしてください' }, 400);
    }
    if (!/[0-9]/.test(pw)) {
      return json({ error: 'パスワードに数字を1つ以上入れてください' }, 400);
    }
    if (!/[A-Z]/.test(pw)) {
      return json({ error: 'パスワードに英大文字（A〜Z）を1つ以上入れてください' }, 400);
    }
    if (!/[a-z]/.test(pw)) {
      return json({ error: 'パスワードに英小文字（a〜z）を1つ以上入れてください' }, 400);
    }

    // ログインIDがメールアドレス形式ならそのまま、そうでなければ内部用のアドレスを割り当てる
    const trimmedUsername = String(username).trim();
    const email = trimmedUsername.includes('@') ? trimmedUsername : `${trimmedUsername}@brownwork.local`;

    // 役割はスタッフか管理者のみ。マスター管理者は役割変更の画面から設定する
    const newRole = role === 'admin' ? 'admin' : 'employee';

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      const msg = createError?.message?.includes('already registered')
        ? 'そのメールアドレスは既に使用されています'
        : createError?.message || 'アカウント作成に失敗しました';
      return json({ error: msg }, 400);
    }

    const row: Record<string, unknown> = {
      id: created.user.id,
      username: trimmedUsername,
      name,
      role: newRole,
      hire_date: hireDate || new Date().toISOString().slice(0, 10),
    };
    if (furigana) row.furigana = furigana;
    if (contactEmail) row.contact_email = contactEmail;
    if (newRole === 'admin' && Array.isArray(adminPermissions)) row.admin_permissions = adminPermissions;

    const { error: insertError } = await adminClient.from('employees').insert(row);
    if (insertError) {
      // employees行の作成に失敗したら、作ってしまったAuthユーザーを削除してロールバック
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: `スタッフ情報の登録に失敗しました: ${insertError.message}` }, 400);
    }

    return json({ ok: true, id: created.user.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '不明なエラーが発生しました' }, 500);
  }
});
