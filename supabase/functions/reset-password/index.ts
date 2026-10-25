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
      .select('role, name')
      .eq('id', userData.user.id)
      .single();
    if (!caller || (caller.role !== 'admin' && caller.role !== 'master_admin')) {
      return json({ error: '管理者のみパスワードを再発行できます' }, 403);
    }

    const { employeeId, newPassword } = (await req.json()) || {};
    if (!employeeId || !newPassword) {
      return json({ error: 'employeeId と newPassword は必須です' }, 400);
    }

    // 対象のスタッフを調べる。
    // ここが無いと、管理者がマスター管理者のIDを指定してパスワードを
    // 書き換え、そのアカウントでログインできてしまう（権限の昇格）。
    // 画面に再発行のボタンが出ていなくても、この関数を直接呼べば通る。
    // delete-employee と同じ形で守る。
    const { data: target } = await adminClient
      .from('employees')
      .select('id, role, name, username')
      .eq('id', employeeId)
      .maybeSingle();
    if (!target) {
      return json({ error: '対象のスタッフが見つかりません' }, 404);
    }
    if (target.role === 'master_admin' && caller.role !== 'master_admin') {
      return json({ error: 'マスター管理者のパスワードを再発行できるのはマスター管理者だけです' }, 403);
    }

    // パスワードの決まり。Supabase側の設定（Authentication のパスワード設定）と
    // 画面側（src/App.tsx の passwordProblem）と、create-employee と揃えること。
    //   最低文字数：8 ／ 必要な文字：数字・英大文字・英小文字
    const pw = String(newPassword);
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

    const { error: updateError } = await adminClient.auth.admin.updateUserById(employeeId, {
      password: pw,
    });
    if (updateError) {
      return json({ error: updateError.message || '再発行に失敗しました' }, 400);
    }

    // 監査ログはアプリの画面側でも書いているが、この関数を直接呼ばれた場合は
    // 残らない。誰がいつ誰のパスワードを変えたかは必ず残す必要があるため、
    // 関数側でも記録する（画面からの操作では2件並ぶことになる）。
    try {
      await adminClient.from('audit_logs').insert({
        actor_id: userData.user.id,
        actor_name: caller.name || '',
        action: 'パスワードを再発行（サーバー側の記録）',
        target_employee_id: employeeId,
        detail: `対象: ${target.username || target.name || employeeId}`,
      });
    } catch (e) {
      console.error('監査ログの記録に失敗しました', e);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('パスワード再発行に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
