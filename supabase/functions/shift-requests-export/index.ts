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
    const key = req.headers.get('x-api-key') || '';
    if (key !== EXPORT_KEY) {
      return json({ error: '合言葉が違います' }, 401);
    }

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
