// supabase/functions/shift-confirmed-import/index.ts
//
// スプレッドシートで組んだ確定シフトを Brown Work に取り込むためのAPI。
// 合言葉（SHIFT_EXPORT_KEY）を知っている呼び出し元だけが使える。
//
// 使い方：
//   POST /functions/v1/shift-confirmed-import
//   ヘッダー: x-api-key: <SHIFT_EXPORT_KEY>
//   本文:
//     {
//       "month": "2026-11",
//       "sheetName": "11月",
//       "rows": [
//         { "name": "今村 友哉", "cells": { "2026-11-01": "江八", "2026-11-02": "", ... } }
//       ]
//     }
//
// セルの中身の読み方：
//   空欄                     → 休み
//   記号だけ（●○★☆△×など） → 休み（文字が1つも入っていないセル）
//   調整中など               → その文言のまま活動場所として残す
//   有給を含む               → 有給
//   それ以外（店舗名など）    → 出勤。その文字列を活動場所とする
//
// 氏名は employees.name との完全一致で突き合わせる。
// 一致しなかった氏名は unmatchedNames として返すので、呼び出し元で表示する。
//
// 準備：
//   supabase functions deploy shift-confirmed-import --no-verify-jwt

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// この関数は確定シフトを「書き込む」ため、読み取り専用の
// shift-requests-export とは別の合言葉を使えるようにしてある。
// SHIFT_IMPORT_KEY を設定していればそちらを使い、
// 設定していなければ従来どおり SHIFT_EXPORT_KEY を使う（互換のため）。
const EXPORT_KEY = Deno.env.get('SHIFT_IMPORT_KEY') || Deno.env.get('SHIFT_EXPORT_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// PostgREST をそのまま呼ぶ。外部ライブラリを使わないことで、
// デプロイ時に取りに行く処理がなくなり、失敗しにくくなる。
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

// ============================================================
// 合言葉の照合
// ============================================================
// 1. 長さによらず同じ時間で比べる（合っている文字数を
//    応答時間から推測されないようにするため）。
// 2. 同じ相手が短時間に何度も間違えたら遮断する。
// 3. 間違いは api_access_failures に記録し、管理者が見られるようにする。
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

async function checkApiKey(req: Request, expected: string): Promise<Response | null> {
  const ip = clientIp(req);
  const since = new Date(Date.now() - FAIL_WINDOW_MINUTES * 60_000).toISOString();

  try {
    const res = await rest(
      `api_access_failures?select=id&client_ip=eq.${encodeURIComponent(ip)}` +
        `&occurred_at=gte.${since}&limit=${FAIL_LIMIT + 1}`,
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
  if (await constantTimeEqual(given, expected)) return null;

  try {
    await rest('api_access_failures', {
      method: 'POST',
      body: JSON.stringify({
        function_name: 'shift-confirmed-import',
        client_ip: ip,
        reason: given ? '合言葉が違う' : '合言葉が無い',
      }),
    });
  } catch (_) { /* 記録に失敗しても拒否はする */ }

  return json({ error: '合言葉が違います' }, 401);
}

// 氏名の表記ゆれを吸収する。全角空白・前後の空白・連続した空白をそろえる
const normalizeName = (value: string) =>
  String(value || '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Cell = { kind: 'work' | 'off' | 'paid'; place: string };

// 出勤かどうかは「活動場所が書かれているか」で決める。
// 確定シフトでは、出勤する日に店舗名などを書く運用のため、
// 文字（ひらがな・カタカナ・漢字・英字・数字）が1つも入っていないセルは休みとする。
//   ● ○ ★ ☆ △ × などの記号だけの日 … 休み
//   ● … シフト希望では出勤可能だが、調整の結果その日は休みになった
const HAS_LETTER = /[\p{L}\p{N}]/u;

// 休みを表す言葉。文字が入っていても休みとして扱う
const OFF_WORDS = ['休', '公休', '休み', '欠勤', '休日'];

// セルの文字から、出勤・休み・有給と活動場所を決める。
// 「調整中」などの書き込みも、その文言のまま活動場所として残す。
function readCell(raw: unknown): Cell | null {
  const text = String(raw ?? '').replace(/\u3000/g, ' ').trim();
  if (!text) return { kind: 'off', place: '' };
  if (text.includes('有給') || text.includes('有休')) return { kind: 'paid', place: '' };
  // 記号だけのセル（● ○ ★ ☆ △ × など）は休み。長音記号だけのセルも含める
  const core = text.replace(/[^\p{L}\p{N}]/gu, '').replace(/[ーｰ―]/g, '');
  if (!core || !HAS_LETTER.test(text)) return { kind: 'off', place: '' };
  if (OFF_WORDS.indexOf(core) >= 0) return { kind: 'off', place: '' };
  return { kind: 'work', place: text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!EXPORT_KEY) {
      return json({ error: 'SHIFT_EXPORT_KEY（または SHIFT_IMPORT_KEY）が設定されていません' }, 500);
    }
    const denied = await checkApiKey(req, EXPORT_KEY);
    if (denied) return denied;
    if (req.method !== 'POST') {
      return json({ error: 'POST で呼び出してください' }, 405);
    }

    const body = await req.json().catch(() => null);
    const month = String(body?.month || '');
    const sheetName = String(body?.sheetName || '');
    const rows: { name?: string; cells?: Record<string, unknown> }[] = Array.isArray(body?.rows) ? body.rows : [];

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return json({ error: 'month は YYYY-MM の形式で指定してください' }, 400);
    }
    if (rows.length === 0) {
      return json({ error: '取り込む行がありません' }, 400);
    }

    // 在籍スタッフを取得して、氏名で引けるようにする
    const [empRes, aliasRes] = await Promise.all([
      rest('employees?select=id,name,resignation_date'),
      rest('shift_name_aliases?select=sheet_name,employee_id'),
    ]);
    if (!empRes.ok) {
      return json({ error: `スタッフの取得に失敗しました：${await empRes.text()}` }, 500);
    }
    const employees: { id: string; name: string; resignation_date: string | null }[] = await empRes.json();

    // 「その月に在籍していたか」で判断する。
    // 過去の月を取り込むとき、いま退職済みでもその月には在籍していた方がいるため、
    // 退職日が対象月の初日より前の方だけを対象外にする。
    const monthStart = `${month}-01`;
    const wasActiveInMonth = (e: { resignation_date: string | null }) =>
      !e.resignation_date || e.resignation_date >= monthStart;

    const activeIds = new Set(employees.filter(wasActiveInMonth).map((e) => e.id));
    const resignedNames = new Set(
      employees.filter((e) => !wasActiveInMonth(e)).map((e) => normalizeName(e.name))
    );
    const byName = new Map<string, string>();
    employees
      .filter(wasActiveInMonth)
      .forEach((e) => {
        const key = normalizeName(e.name);
        // 同姓同名がいる場合は、どちらとも突き合わせない（取り違えを防ぐため）
        if (byName.has(key)) byName.set(key, '');
        else byName.set(key, e.id);
      });

    // 氏名の対応表。スプレッドシートの表記とスタッフを結びつける。
    // 完全一致より優先するので、改姓や表記ゆれをここで吸収できる。
    const aliasMap = new Map<string, string>();
    if (aliasRes.ok) {
      const aliases: { sheet_name: string; employee_id: string }[] = await aliasRes.json();
      aliases.forEach((a) => {
        if (activeIds.has(a.employee_id)) aliasMap.set(normalizeName(a.sheet_name), a.employee_id);
      });
    }

    const unmatched: string[] = [];
    const duplicated: string[] = [];
    const resigned: string[] = [];
    const assignments: { employee_id: string; date: string; kind: string; place: string | null; source: string; imported_at: string }[] = [];
    const now = new Date().toISOString();
    let matchedRows = 0;

    for (const row of rows) {
      const name = normalizeName(String(row?.name || ''));
      if (!name) continue;
      // 対応表 → 完全一致 の順に探す
      const employeeId = aliasMap.get(name) ?? byName.get(name);
      if (employeeId === undefined) {
        // 対象月より前に退職した方がシートに残っている場合は、黙って飛ばす
        if (resignedNames.has(name)) {
          if (!resigned.includes(name)) resigned.push(name);
          continue;
        }
        if (!unmatched.includes(name)) unmatched.push(name);
        continue;
      }
      if (employeeId === '') {
        if (!duplicated.includes(name)) duplicated.push(name);
        continue;
      }
      matchedRows += 1;
      const cells = row.cells || {};
      for (const [date, raw] of Object.entries(cells)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!date.startsWith(`${month}-`)) continue;
        const cell = readCell(raw);
        if (!cell) continue;   // 未定の日は登録しない
        assignments.push({
          employee_id: employeeId,
          date,
          kind: cell.kind,
          place: cell.place || null,
          source: 'sheet',
          imported_at: now,
        });
      }
    }

    if (assignments.length === 0) {
      return json({ error: '取り込める内容がありませんでした', unmatchedNames: unmatched }, 400);
    }

    // その月の既存分を、取り込んだスタッフの分だけ消してから入れ直す。
    // 取り込み対象外のスタッフのシフトは触らない。
    const employeeIds = Array.from(new Set(assignments.map((a) => a.employee_id)));
    const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    const from = `${month}-01`;
    const to = `${month}-${String(lastDay).padStart(2, '0')}`;

    // 消す前に、いまの内容を読んでおく。あとで差分を出すため
    const beforeMap = new Map<string, { kind: string; place: string | null }>();
    const beforeRes = await rest(
      `shift_assignments?select=employee_id,date,kind,place&employee_id=in.(${employeeIds.join(',')})&date=gte.${from}&date=lte.${to}`
    );
    if (beforeRes.ok) {
      const beforeRows: { employee_id: string; date: string; kind: string; place: string | null }[] = await beforeRes.json();
      beforeRows.forEach((r) => beforeMap.set(`${r.employee_id}|${r.date}`, { kind: r.kind, place: r.place }));
    }

    const delRes = await rest(
      `shift_assignments?employee_id=in.(${employeeIds.join(',')})&date=gte.${from}&date=lte.${to}`,
      { method: 'DELETE' }
    );
    if (!delRes.ok) {
      return json({ error: `古い内容の削除に失敗しました：${await delRes.text()}` }, 500);
    }

    // まとめて入れる。件数が多くなるため500件ずつに分ける
    for (let i = 0; i < assignments.length; i += 500) {
      const chunk = assignments.slice(i, i + 500);
      const insRes = await rest('shift_assignments', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      if (!insRes.ok) {
        return json({ error: `取り込みに失敗しました：${await insRes.text()}` }, 500);
      }
    }

    // 履歴を残す（失敗しても取り込み自体は成功扱いにする）
    await rest('shift_import_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{
        target_month: month,
        sheet_name: sheetName || null,
        total_rows: rows.length,
        matched_rows: matchedRows,
        unmatched_names: [...unmatched, ...duplicated.map((n) => `${n}（同姓同名）`)],
        assignment_count: assignments.length,
      }]),
    }).catch(() => undefined);

    // 前回と違う日だけを履歴に残す
    const changes: {
      employee_id: string; date: string; target_month: string;
      before_kind: string | null; before_place: string | null;
      after_kind: string | null; after_place: string | null;
    }[] = [];
    const seen = new Set<string>();
    assignments.forEach((a) => {
      const key = `${a.employee_id}|${a.date}`;
      seen.add(key);
      const before = beforeMap.get(key);
      const beforePlace = before ? (before.place || '') : '';
      const afterPlace = a.place || '';
      if (!before || before.kind !== a.kind || beforePlace !== afterPlace) {
        changes.push({
          employee_id: a.employee_id,
          date: a.date,
          target_month: month,
          before_kind: before ? before.kind : null,
          before_place: before ? before.place : null,
          after_kind: a.kind,
          after_place: a.place,
        });
      }
    });
    // 今回の取り込みに含まれなくなった日
    beforeMap.forEach((before, key) => {
      if (seen.has(key)) return;
      const [employeeId, date] = key.split('|');
      changes.push({
        employee_id: employeeId,
        date,
        target_month: month,
        before_kind: before.kind,
        before_place: before.place,
        after_kind: null,
        after_place: null,
      });
    });

    // 初回の取り込み（前回の内容が1件も無い）では履歴を残さない。
    // 全日が「新しく入った」になり、変更のお知らせが全員に飛んでしまうため。
    if (beforeMap.size > 0 && changes.length > 0) {
      for (let i = 0; i < changes.length; i += 500) {
        await rest('shift_assignment_changes', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(changes.slice(i, i + 500)),
        }).catch(() => undefined);
      }
    }

    const changedEmployeeIds = Array.from(new Set(changes.map((c) => c.employee_id)));
    const workDays = assignments.filter((a) => a.kind === 'work').length;
    const paidDays = assignments.filter((a) => a.kind === 'paid').length;
    const offDays = assignments.filter((a) => a.kind === 'off').length;

    return json({
      month,
      totalRows: rows.length,
      matchedRows,
      unmatchedNames: unmatched,
      duplicatedNames: duplicated,
      resignedNames: resigned,
      assignmentCount: assignments.length,
      changeCount: beforeMap.size > 0 ? changes.length : 0,
      changedStaffCount: beforeMap.size > 0 ? changedEmployeeIds.length : 0,
      firstImport: beforeMap.size === 0,
      workDays,
      paidDays,
      offDays,
      importedAt: now,
    });
  } catch (e) {
    console.error('確定シフトの取り込みに失敗しました', e);
    return json({ error: '取り込みに失敗しました' }, 500);
  }
});
