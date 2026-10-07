import type { ProjectDbRecord } from '../../api/projectDb';
import { findNonShiftJis } from '../../export/sjis';
import { h } from '../dom';

/** 業務DBから取得した内容と、確認してほしい点を表示する */
export function renderProjectDbResult(target: HTMLElement, rec: ProjectDbRecord | null, contractorName: string): void {
  target.replaceChildren();
  if (!rec) return;
  const warnings: string[] = [];
  warnings.push(rec.clientLooksLikeCompany
    ? `発注機関名称が会社名（${rec.clientName}）です。下請案件では元請の会社名が入るため、本来の発注機関に直してください。`
    : '発注機関名称は、下請案件では元請の会社名になります。正しいか確認してください。');
  if (!rec.clientName) warnings.push('業務DBに発注機関が登録されていません。手入力してください。');
  for (const [label, value] of [['調査件名', rec.surveyTitle], ['発注機関名称', rec.clientName]] as const) {
    const bad = findNonShiftJis(value);
    if (bad) warnings.push(`${label}の「${bad}」は電子納品（Shift_JIS）で使えない文字です。別の文字に置き換えてください。`);
  }
  target.append(
    h('div', { class: 'db-heading' }, `業務DBから取得しました（業務番号 ${rec.projectNumber}）`),
    h('dl', {},
      h('dt', {}, '調査件名'), h('dd', {}, rec.surveyTitle || '（登録なし）'),
      h('dt', {}, '発注機関名称'), h('dd', {}, rec.clientName || '（登録なし）'),
      ...(contractorName ? [h('dt', {}, '調査業者名'), h('dd', {}, contractorName)] : []),
    ),
    ...warnings.map((w) => h('p', { class: 'warn' }, w)),
  );
}
