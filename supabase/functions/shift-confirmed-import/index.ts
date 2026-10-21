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
//   空欄          → 休み
//   有給を含む    → 有給
//   それ以外      → 出勤。その文字列を活動場所とする
//
// 氏名は employees.name との完全一致で突き合わせる。
// 一致しなかった氏名は unmatchedNames として返すので、呼び出し元で表示する。
//
// 準備：
//   supabase functions deploy shift-confirmed-import --no-verify-jwt

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

// 氏名の表記ゆれを吸収する。全角空白・前後の空白・連続した空白をそろえる
const normalizeName = (value: string) =>
  String(value || '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Cell = { kind: 'work' | 'off' | 'paid'; place: string };

// セルの文字から、出勤・休み・有給と活動場所を決める
function readCell(raw: unknown): Cell {
  const text = String(raw ?? '').replace(/　/g, ' ').trim();
  if (!text) return { kind: 'off', place: '' };
  if (text.includes('有給') || text.includes('有休')) return { kind: 'paid', place: '' };
  // 「×」だけ、「休」だけの表記も休みとして扱う
  if (/^[×x✕✖╳－ー—-]+$/i.test(text) || text === '休') return { kind: 'off', place: '' };
  return { kind: 'work', place: text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!EXPORT_KEY) {
      return json({ error: 'SHIFT_EXPORT_KEY が設定されていません' }, 500);
    }
    if ((req.headers.get('x-api-key') || '') !== EXPORT_KEY) {
      return json({ error: '合言葉が違います' }, 401);
    }
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
    const empRes = await rest('employees?select=id,name,resignation_date');
    if (!empRes.ok) {
      return json({ error: `スタッフの取得に失敗しました：${await empRes.text()}` }, 500);
    }
    const employees: { id: string; name: string; resignation_date: string | null }[] = await empRes.json();
    const byName = new Map<string, string>();
    employees
      .filter((e) => !e.resignation_date)
      .forEach((e) => {
        const key = normalizeName(e.name);
        // 同姓同名がいる場合は、どちらとも突き合わせない（取り違えを防ぐため）
        if (byName.has(key)) byName.set(key, '');
        else byName.set(key, e.id);
      });

    const unmatched: string[] = [];
    const duplicated: string[] = [];
    const assignments: { employee_id: string; date: string; kind: string; place: string | null; source: string; imported_at: string }[] = [];
    const now = new Date().toISOString();
    let matchedRows = 0;

    for (const row of rows) {
      const name = normalizeName(String(row?.name || ''));
      if (!name) continue;
      const employeeId = byName.get(name);
      if (employeeId === undefined) {
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

    const workDays = assignments.filter((a) => a.kind === 'work').length;
    const paidDays = assignments.filter((a) => a.kind === 'paid').length;
    const offDays = assignments.filter((a) => a.kind === 'off').length;

    return json({
      month,
      totalRows: rows.length,
      matchedRows,
      unmatchedNames: unmatched,
      duplicatedNames: duplicated,
      assignmentCount: assignments.length,
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
