// supabase/functions/shift-requests-export/index.ts
//
// スプレッドシート（Google Apps Script）からシフト希望を取り込むための読み取り専用API。
// 合言葉（SHIFT_EXPORT_KEY）を知っている呼び出し元にだけ、指定した月の希望を返す。
//
// 使い方：
//   GET /functions/v1/shift-requests-export?month=2026-11
//   ヘッダー: x-api-key: <SHIFT_EXPORT_KEY>
//
// 準備：
//   supabase secrets set SHIFT_EXPORT_KEY=<好きな長い文字列>
//   supabase functions deploy shift-requests-export --no-verify-jwt
//
// --no-verify-jwt を付ける理由：
//   スプレッドシートからはログインせずに呼ぶため。かわりに x-api-key で守る。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPORT_KEY = Deno.env.get('SHIFT_EXPORT_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

// ============================================================
// 合言葉の照合（共通）
// ============================================================
// 1. 文字列を1文字ずつ比べると、合っている文字数によって
//    返ってくるまでの時間がわずかに変わる。それを手がかりに
//    合言葉を1文字ずつ当てられないよう、長さによらず
//    同じ時間で比べる（両方をHMACにしてから比べる）。
// 2. 同じ相手が短時間に何度も間違えたら遮断する（総当たり対策）。
// 3. 間違いは api_access_failures に記録して、管理者が見られるようにする。
const FAIL_WINDOW_MINUTES = 15;
const FAIL_LIMIT = 20;

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyData = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

const clientIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

// 失敗の記録と遮断の判定。合言葉が合っていれば null、
// 合っていなければ返すべき Response を返す。
async function checkApiKey(
  req: Request,
  functionName: string,
  expected: string,
): Promise<Response | null> {
  const ip = clientIp(req);
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const since = new Date(Date.now() - FAIL_WINDOW_MINUTES * 60_000).toISOString();

  // 直近の失敗回数を数える（数えられなくても処理は止めない）
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/api_access_failures` +
        `?select=id&client_ip=eq.${encodeURIComponent(ip)}&occurred_at=gte.${since}&limit=${FAIL_LIMIT + 1}`,
      { headers },
    );
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows.length > FAIL_LIMIT) {
      return json(
        { error: `合言葉の間違いが続いたため、${FAIL_WINDOW_MINUTES}分ほどお待ちください` },
        429,
      );
    }
  } catch (_) { /* 記録が使えなくても本来の処理は続ける */ }

  const given = req.headers.get('x-api-key') || '';
  // 【順番が大事】expected が空文字のときは、ヘッダを付けずに呼ぶと
  // '' と '' の比較になって通ってしまう。
  // そのため呼び出し元（Deno.serve の中）で、この関数を呼ぶ前に
  // 「EXPORT_KEY が空なら 500 で返す」ガードを入れてある。
  // ここを別の場所から呼ぶときは、同じガードを必ず先に置くこと。
  if (await constantTimeEqual(given, expected)) return null;

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/api_access_failures`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        function_name: functionName,
        client_ip: ip,
        reason: given ? '合言葉が違う' : '合言葉が無い',
      }),
    });
  } catch (_) { /* 記録に失敗しても拒否はする */ }

  return json({ error: '合言葉が違います' }, 401);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// 答えの値 → スプレッドシートに書く文字
// 'ok' | 'off' | 'paid' のほか、活動場所を入力する部署は 'place:<活動場所>' で入る。
// その場合は記号ではなく活動場所をそのまま書く。
const SYMBOL: Record<string, string> = { ok: '●', off: '×', paid: '有給' };
const PLACE_PREFIX = 'place:';
const cellText = (value: unknown): string => {
  const v = String(value ?? '');
  if (v.startsWith(PLACE_PREFIX)) return v.slice(PLACE_PREFIX.length).trim();
  return SYMBOL[v] || '';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!EXPORT_KEY) {
      return json({ error: 'SHIFT_EXPORT_KEY が設定されていません' }, 500);
    }
    const denied = await checkApiKey(req, 'shift-requests-export', EXPORT_KEY);
    if (denied) return denied;

    const url = new URL(req.url);
    const month = url.searchParams.get('month') || '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return json({ error: 'month は YYYY-MM の形式で指定してください' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const [{ data: employees, error: empError }, { data: answers, error: ansError }, { data: periods }] =
      await Promise.all([
        admin.from('employees').select('id, name, resignation_date, main_group').order('name'),
        admin.from('shift_request_answers').select('employee_id, answers, note, submitted_at').eq('target_month', month),
        admin.from('shift_request_periods').select('*').eq('target_month', month),
      ]);

    if (empError) return json({ error: `スタッフの取得に失敗しました：${empError.message}` }, 500);
    if (ansError) return json({ error: `シフト希望の取得に失敗しました：${ansError.message}` }, 500);

    const period = (periods || [])[0] || null;
    const targetIds: string[] = Array.isArray(period?.target_employee_ids) ? period!.target_employee_ids : [];

    // 対象月の日付を並べる
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const days: { date: string; day: number; weekday: string }[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      days.push({ date, day: d, weekday: weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()] });
    }

    const byEmployee: Record<string, { answers: Record<string, string>; note: string; submittedAt: string }> = {};
    (answers || []).forEach((a: any) => {
      byEmployee[a.employee_id] = {
        answers: a.answers || {},
        note: a.note || '',
        submittedAt: a.submitted_at,
      };
    });

    const rows = (employees || [])
      .filter((e: any) => !e.resignation_date)
      .filter((e: any) => targetIds.length === 0 || targetIds.includes(e.id))
      .map((e: any) => {
        const found = byEmployee[e.id];
        return {
          name: e.name as string,
          group: (e.main_group || '') as string,
          submitted: !!found,
          note: found?.note || '',
          submittedAt: found?.submittedAt || '',
          // 日付順の記号。未提出や未選択は空文字
          cells: days.map((d) => (found ? cellText(found.answers[d.date]) : '')),
        };
      });

    return json({
      month,
      deadline: period?.deadline || '',
      isOpen: period?.is_open !== false,
      days,
      rows,
      submittedCount: rows.filter((r) => r.submitted).length,
      totalCount: rows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('シフト希望の書き出しに失敗しました', e);
    return json({ error: '書き出しに失敗しました' }, 500);
  }
});
