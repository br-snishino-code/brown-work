// supabase/functions/sync-resigned-auth/index.ts
//
// 退職日を過ぎたスタッフの「ログインそのもの」を止める。
//
// デプロイ方法：
//   supabase functions deploy sync-resigned-auth
//   ※ --no-verify-jwt は付けないこと（管理者だけが呼べる関数です）
//
// 【背景（監査の第3段階）】
//   退職日を設定しても、これまで止まっていたのは画面の表示だけだった。
//   ブラウザの中で signOut しているので、すでに持っているトークンを使って
//   API を直接叩けば、退職後も自分の勤怠・給与明細・マイナンバーを
//   読み書きできる状態だった。
//   この関数は Supabase Auth 側でアカウントを停止（ban）するため、
//   トークンそのものが使えなくなる。
//
// 動き：
//   退職日が今日以前のスタッフ … ログインを停止する
//   退職日が無い／未来のスタッフ … 停止されていれば解除する
//                                  （退職日の入力間違いを直せるようにするため）
//
// 呼び出し元：
//   1. 管理者がスタッフの退職日を保存したとき
//   2. 管理者がログインしたとき（将来の日付で登録した分を、その日が来たら止める）

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// 実質的に無期限（100年）。解除は ban_duration: 'none' で行う。
const BAN_FOREVER = '876000h';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const todayKey = () => {
  // 日本時間の「今日」。UTCのままだと、深夜に1日ずれる。
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
};

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
      .maybeSingle();
    if (!caller || (caller.role !== 'admin' && caller.role !== 'master_admin')) {
      return json({ error: '管理者のみ実行できます' }, 403);
    }

    const { data: employees, error: empError } = await adminClient
      .from('employees')
      .select('id, name, resignation_date');
    if (empError) {
      return json({ error: `スタッフの取得に失敗しました：${empError.message}` }, 500);
    }

    // Auth のアカウントは一覧でまとめて取る。
    // 1人ずつ問い合わせると、スタッフが増えたときに
    // 管理者のログインのたびに何百回も通信することになるため。
    const bannedUntilById = new Map<string, string | null>();
    for (let page = 1; page <= 20; page++) {
      const { data: listed, error: listError } = await adminClient.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listError) {
        return json({ error: `アカウント一覧の取得に失敗しました：${listError.message}` }, 500);
      }
      const users = listed?.users || [];
      for (const u of users) {
        bannedUntilById.set(u.id, (u as { banned_until?: string | null }).banned_until ?? null);
      }
      if (users.length < 1000) break;
    }

    const today = todayKey();
    const banned: string[] = [];
    const unbanned: string[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const emp of employees || []) {
      // 自分自身は対象外（操作中の管理者を締め出さないため）
      if (emp.id === userData.user.id) continue;

      const shouldBan = !!emp.resignation_date && emp.resignation_date <= today;

      // Auth 側にアカウントが無い（作成前・削除済み）場合は何もしない
      if (!bannedUntilById.has(emp.id)) continue;

      // banned_until は停止中のときだけ入る。'none' の文字が入る実装もある。
      const bannedUntil = bannedUntilById.get(emp.id);
      const isBanned = !!bannedUntil && bannedUntil !== 'none'
        && new Date(bannedUntil).getTime() > Date.now();

      // 変える必要があるときだけ書き換える
      if (shouldBan && !isBanned) {
        const { error } = await adminClient.auth.admin.updateUserById(emp.id, {
          ban_duration: BAN_FOREVER,
        });
        if (error) failed.push({ name: emp.name, reason: error.message });
        else banned.push(emp.name);
      } else if (!shouldBan && isBanned) {
        const { error } = await adminClient.auth.admin.updateUserById(emp.id, {
          ban_duration: 'none',
        });
        if (error) failed.push({ name: emp.name, reason: error.message });
        else unbanned.push(emp.name);
      }
    }

    return json({ ok: true, banned, unbanned, failed, today });
  } catch (e) {
    console.error('退職者の同期に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
