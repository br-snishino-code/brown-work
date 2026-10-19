// supabase/functions/reset-password/index.ts
//
// 管理者だけが呼び出せる「パスワード再発行」用Edge Function。
//
// デプロイ方法：
//   supabase functions deploy reset-password

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '認証情報がありません' }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: '認証に失敗しました' }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: caller } = await adminClient
      .from('employees')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (!caller || (caller.role !== 'admin' && caller.role !== 'master_admin')) {
      return json({ error: '管理者のみパスワードを再発行できます' }, 403);
    }

    const { employeeId, newPassword } = (await req.json()) || {};
    if (!employeeId || !newPassword) {
      return json({ error: 'employeeId と newPassword は必須です' }, 400);
    }
    if (String(newPassword).length < 6) {
      return json({ error: 'パスワードは6文字以上にしてください' }, 400);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(employeeId, {
      password: String(newPassword),
    });
    if (updateError) {
      return json({ error: updateError.message || '再発行に失敗しました' }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('パスワード再発行に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
