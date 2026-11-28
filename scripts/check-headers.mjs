// vercel.json と public/_headers のセキュリティヘッダーが同じか調べます。
//
// 【なぜ要るか】
//   いまは Vercel で動いており、ヘッダーは vercel.json が効いています。
//   Cloudflare Pages に移したときは public/_headers が効きます。
//   両方に同じ内容を置いてあるので、片方だけ直すと、
//   移した日に守りが古いまま動くことになります。
//   それを出す前に見つけるための点検です。
//
// 使い方：npm run check-headers
//   ずれていれば、どのヘッダーがどう違うかを出して、1 で終わります。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// vercel.json の "/(.*)" に当てているヘッダーを読みます
function fromVercel() {
  const v = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  const rule = (v.headers || []).find((h) => h.source === '/(.*)');
  if (!rule) throw new Error('vercel.json に "/(.*)" のヘッダーがありません');
  const out = {};
  for (const h of rule.headers || []) out[h.key] = h.value;
  return out;
}

// public/_headers の "/*" に当てているヘッダーを読みます
function fromHeaders() {
  const text = readFileSync(join(root, 'public', '_headers'), 'utf8');
  const out = {};
  let inAll = false;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!raw.startsWith(' ')) {           // 字下げのない行は、当てる先の指定
      inAll = raw.trim() === '/*';
      continue;
    }
    if (!inAll) continue;
    const line = raw.trim();
    const at = line.indexOf(': ');
    if (at < 0) continue;
    out[line.slice(0, at)] = line.slice(at + 2);
  }
  return out;
}

const a = fromVercel();
const b = fromHeaders();

const problems = [];
for (const [k, v] of Object.entries(a)) {
  if (!(k in b)) problems.push(`public/_headers に ${k} がありません`);
  else if (b[k] !== v) {
    problems.push(`${k} の中身が違います\n    vercel.json     : ${v}\n    public/_headers : ${b[k]}`);
  }
}
for (const k of Object.keys(b)) {
  if (!(k in a)) problems.push(`vercel.json に ${k} がありません`);
}

if (problems.length > 0) {
  console.error('セキュリティヘッダーがずれています：\n');
  for (const p of problems) console.error(`  ・${p}`);
  console.error('\n  vercel.json と public/_headers を同じ中身にしてください。');
  process.exit(1);
}

console.log(`セキュリティヘッダーは一致しています（${Object.keys(a).length}件）`);
