// フックの使い方だけを調べる設定。
//
// なぜ要るか：
//   React は「描画のたびに、同じ数のフックを同じ順番で呼ぶ」ことを前提にしている。
//   早期 return より後ろに useState や useMemo を書くと、その return を通った
//   ときだけフックの数が減り、画面が真っ白になる（Minified React error #300）。
//   ビルドも tsc も、この間違いを見つけられない。
//
//   実際に2件あった：
//     ・AccountManagement … スタッフ詳細を開くと落ちた
//     ・ShiftAssignmentTab … 確定シフトの表が未作成のときに落ちる状態だった
//
// 使い方：
//   npm run check-hooks
//
// 何も出力されなければ問題なし。
import hooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.tsx', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
];
