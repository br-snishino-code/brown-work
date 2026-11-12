import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { CorrectionModal } from '../src/App.tsx';
window.__sent = null;
const iso = (h, m, s = 0) => `2026-11-10T${String(h - 9).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
const cases = {
  // 申請中（退勤だけの申請）＋ 出勤は09:00で打刻済み
  pendout: { record: { clockIn: iso(9, 0), clockOut: null },
    pending: { id: 'c1', employeeId: 'e1', date: '2026-11-10', status: 'pending', submittedAt: '2026-11-11T00:00:00Z',
      reason: '退勤忘れ', original: { clockIn: iso(9, 0), clockOut: null }, requested: { date: '2026-11-10', clockOut: '18:00' } } },
  // 申請中（両方の申請）
  pendboth: { record: { clockIn: iso(9, 0), clockOut: iso(18, 0) },
    pending: { id: 'c2', employeeId: 'e1', date: '2026-11-10', status: 'pending', submittedAt: '2026-11-11T00:00:00Z',
      reason: '打ち間違い', original: { clockIn: iso(9, 0), clockOut: iso(18, 0) }, requested: { date: '2026-11-10', clockIn: '10:00', clockOut: '19:00' } } },
  // 秒だけ違う打刻（出勤09:00:10 / 退勤09:00:50）
  seconds: { record: { clockIn: iso(9, 0, 10), clockOut: iso(9, 0, 50) }, pending: null },
};
function App() {
  const [k, setK] = useState(location.hash.slice(1) || 'pendout');
  const c = cases[k];
  return (
    <div className="bg-slate-100 min-h-screen">
      <div className="relative z-50 flex gap-1 p-2 bg-white border-b">
        {Object.keys(cases).map((x) => (
          <button key={x} onClick={() => setK(x)} className={`px-2 py-1 text-[11px] rounded border ${k === x ? 'bg-slate-900 text-white' : 'bg-white'}`}>{x}</button>
        ))}
      </div>
      <CorrectionModal key={k} dateKey="2026-11-10" record={c.record} pending={c.pending}
        onClose={() => {}} onSubmit={async (p) => { window.__sent = p; }} onCancelRequest={async () => {}} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
