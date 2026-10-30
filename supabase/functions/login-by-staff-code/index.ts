// supabase/functions/login-by-staff-code/index.ts
//
// スタッフコードでログインする。
//
// デプロイ方法：
//   supabase functions deploy login-by-staff-code
//   ※ --no-verify-jwt は付けないこと。
//     ログイン前に呼ぶ関数だが、アプリが持つ anon キーでゲートウェイは通る。
//     無関係な相手からの呼び出しを、その段階で減らすため。
//
// 【なぜサーバー側でログインまで行うか】
//   ログインは認証前なので、ブラウザから「このコードは誰か」を引けません。
//   引ける作りにすると、誰でもスタッフコードの存在を試せることになります
//   （コードは B001 のように推測しやすいため、存在が分かるだけで不利です）。
//   そこで、コードの照会とログインをこの関数の中で続けて行い、
//   外には「入れたか、入れなかったか」だけを返します。
//
// 【返す文言はいつも同じ】
//   コードが無い場合も、パスワードが違う場合も、退職済みの場合も、
//   同じ文言を返します。どれなのかが分かると、コードの存在が知られるためです。
//
// 【記録しないもの】
//   パスワードはどこにも記録しません。失敗の記録に残すのは
//   入力されたコードと理由だけです（既存の record-login-attempt と同じ扱い）。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// 同じ相手が短時間に何度も試したら止める
const WINDOW_MINUTES = 15;
const MAX_FAILURES = 20;

// 入れなかったときに返す文言。中身によらずこれだけを返す
const SAME_MESSAGE = 'スタッフコードまたはパスワードが違います';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || req.headers.get('cf-connecting-ip')
  || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405);

  let staffCode = '';
  let password = '';
  try {
    const body = await req.json();
    staffCode = String(body?.staffCode ?? '').trim();
    password = String(body?.password ?? '');
  } catch {
    return json({ error: SAME_MESSAGE }, 401);
  }
  if (!staffCode || !password) return json({ error: SAME_MESSAGE }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  // 失敗を残す。残せなくてもログインの判定は変えない
  const recordFailure = async (reason: string) => {
    try {
      await admin.from('login_attempts').insert({
        username: staffCode,
        client_ip: ip,
        user_agent: req.headers.get('user-agent') || '',
        reason,
      });
    } catch (_) {
      // 記録できなくても続ける
    }
  };

  // 同じIPからの失敗が続いていたら、照会そのものを止める
  if (ip) {
    try {
      const { count } = await admin
        .from('login_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('client_ip', ip)
        .gte('occurred_at', since);
      if ((count ?? 0) > MAX_FAILURES) {
        return json(
          { error: `ログインの失敗が続いたため、${WINDOW_MINUTES}分ほどお待ちください` },
          429,
        );
      }
    } catch (_) {
      // 数えられなくても止めない
    }
  }

  // コードからアカウントを引く。
  // 大文字小文字と前後の空白は区別しない（90番の一意インデックスと同じ基準）。
  //
  // ilike のパターンでは % と _ がワイルドカードになります。
  // 入力をそのまま渡すと「%」1文字で全員に当たってしまうため、必ず打ち消します。
  const escaped = staffCode.replace(/([\\%_])/g, '\\$1');
  const { data: rows, error: lookupError } = await admin
    .from('employees')
    .select('id, username, staff_number, resignation_date')
    .ilike('staff_number', escaped);

  if (lookupError) {
    console.error('スタッフコードの照会に失敗しました', lookupError.message);
    return json({ error: 'ログインに失敗しました。しばらくしてからお試しください' }, 500);
  }

  // ilike は前後の空白までは吸収しないので、ここでそろえて絞り込む
  const key = staffCode.toLowerCase();
  const matched = (rows || []).filter(
    (r: { staff_number?: string | null }) =>
      String(r.staff_number ?? '').trim().toLowerCase() === key,
  );
  // 1人に決まらないときは入れない（90番の一意インデックスで起きないはずですが、
  // 念のため。どちらの方か決められないままログインさせないためです）
  const found = matched.length === 1 ? matched[0] : null;

  // 見つからない／複数ある／退職済み。いずれも同じ文言を返す
  const today = new Date().toISOString().slice(0, 10);
  const retired = found?.resignation_date && String(found.resignation_date) < today;
  if (!found || !found.username || retired) {
    await recordFailure(
      !found ? 'スタッフコードに一致するアカウントがありません'
        : retired ? '退職済みのアカウントです'
          : 'ログインIDが未登録のアカウントです',
    );
    return json({ error: SAME_MESSAGE }, 401);
  }

  // ログインIDに変換する（アプリ側の usernameToEmail と同じ決まり）
  const username = String(found.username).trim();
  const email = username.includes('@') ? username : `${username}@brownwork.local`;

  // ここからは通常のログインと同じ。anon キーのクライアントで認証する
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: signed, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signed?.session) {
    await recordFailure('パスワードが違います（スタッフコードでのログイン）');
    return json({ error: SAME_MESSAGE }, 401);
  }

  // セッションだけを返す。アプリ側が setSession で受け取る。
  // 2段階認証を設定している方は、この時点ではまだ aal1 なので、
  // アプリ側のこれまでどおりの流れでコードの入力に進む。
  return json({
    access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token,
  });
});
