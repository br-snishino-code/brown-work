import React from 'react';
import ReactDOM from 'react-dom/client';
import AttendanceApp, { NewVersionBanner } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* 新しい版が出たことを知らせる帯。ログイン前でも出したいので、
        アプリ本体の外側に置いています */}
    <NewVersionBanner />
    <AttendanceApp />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
