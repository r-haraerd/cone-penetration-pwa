import { repository } from '../../db/repository';
import type { ProjectSnapshot } from '../../domain/types';
import { buildColumnSheetDxf } from '../../export/columnDxf';
import { buildJgs1433Xml, jgsXmlFileName, type DeliveryInfo } from '../../export/jgsXml';
import { encodeShiftJis, findNonShiftJis } from '../../export/sjis';
import { createZip } from '../../export/zip';
import { h } from '../dom';
import { errorText, showError } from '../components/layout';
import { fileTimestamp, safeFileName, saveFile } from '../fileSave';
import { renderProjectDbResult } from '../components/projectDbResult';
import { fetchProjectRecord, projectDbAvailable } from '../../api/projectDb';
import { appConfig } from '../../config';

const FIELDS: Array<{ key: keyof DeliveryInfo; label: string; placeholder: string }> = [
  { key: 'surveyTitle', label: '調査件名', placeholder: '例：令和○年度 ○○地区地質調査業務委託' },
  { key: 'clientName', label: '発注機関名称', placeholder: '例：○○土木事務所' },
  { key: 'contractorName', label: '調査業者名', placeholder: '例：○○地質株式会社' },
  { key: 'testerName', label: '試験者', placeholder: '例：山田太郎' },
];

/**
 * 電子納品データ（地点ごとの XML と簡易貫入柱状図 DXF）の出力欄。
 * 案件の「データ出力・バックアップ」画面に置く。
 */
export function deliverySection(snapshot: ProjectSnapshot): HTMLElement {
  const { project } = snapshot;
  const projectId = project.id;
  const inputs = {} as Record<keyof DeliveryInfo, HTMLInputElement>;
  const error = errorText();
  const message = h('p', { class: 'result-text', 'aria-live': 'polite' });
  const measured = snapshot.points.filter((p) => p.measurements.length > 0);
  const unmeasured = snapshot.points.filter((p) => p.measurements.length === 0);
  const baseName = `${safeFileName(project.projectNumber)}_${safeFileName(project.projectName)}`;

  const fields = FIELDS.map(({ key, label, placeholder }) => {
    const input = h('input', {
      id: `delivery-${key}`, class: 'text-input', type: 'text', autocomplete: 'off', placeholder,
      // 調査業者名は空なら既定値（自社名）を入れておく
      value: project.delivery?.[key] || (key === 'contractorName' ? appConfig.defaultContractorName : ''),
    });
    inputs[key] = input;
    return [h('label', { class: 'field-label', for: `delivery-${key}` }, label), input];
  }).flat();

  /** 入力値を検証して保存し、出力に使う情報を返す（問題があれば null） */
  const saveInfo = async (): Promise<DeliveryInfo | null> => {
    error.textContent = '';
    const info = Object.fromEntries(FIELDS.map(({ key }) => [key, inputs[key].value.trim()])) as unknown as DeliveryInfo;
    for (const { key, label } of FIELDS) {
      const bad = findNonShiftJis(info[key]);
      if (bad) {
        error.textContent = `${label}の「${bad}」は電子納品（Shift_JIS）で使えない文字です。別の文字に置き換えてください。`;
        inputs[key].focus();
        return null;
      }
    }
    await repository.updateDeliveryInfo(projectId, info);
    const empty = FIELDS.filter(({ key }) => !info[key]).map(({ label }) => label);
    message.textContent = empty.length ? `未入力：${empty.join('、')}（空欄のまま出力されます）` : '';
    return info;
  };

  const dbResult = h('div', { class: 'db-result', id: 'delivery-db-result' });
  const fetchFromDb = async (button: HTMLButtonElement) => {
    error.textContent = '';
    message.textContent = '業務DBを確認しています…';
    button.disabled = true;
    try {
      const rec = await fetchProjectRecord(project.projectNumber);
      inputs.surveyTitle.value = rec.surveyTitle;
      inputs.clientName.value = rec.clientName;
      if (!inputs.contractorName.value.trim()) inputs.contractorName.value = appConfig.defaultContractorName;
      message.textContent = '';
      renderProjectDbResult(dbResult, rec, inputs.contractorName.value.trim());
      await saveInfo();
    } catch (e) {
      message.textContent = '';
      showError(error, e);
    } finally {
      button.disabled = false;
    }
  };
  const dbButton: HTMLButtonElement | null = projectDbAvailable()
    ? h('button', { type: 'button', class: 'btn btn-secondary', 'data-action': 'fetch-db', onclick: () => void fetchFromDb(dbButton!) }, `業務DBから取得（業務番号 ${project.projectNumber}）`)
    : null;

  const exportXml = async () => {
    try {
      const info = await saveInfo();
      if (!info) return;
      const fresh = await repository.getProjectSnapshot(projectId);
      const files = fresh.points
        .filter((p) => p.measurements.length > 0)
        .map((p) => ({ name: jgsXmlFileName(p.point), data: encodeShiftJis(buildJgs1433Xml(info, p.point, p.measurements)) }));
      if (files.length === 0) {
        error.textContent = '記録のある地点がありません。';
        return;
      }
      const zip = createZip(files);
      const outcome = await saveFile(`${baseName}_電子納品XML_${fileTimestamp()}.zip`, new Blob([zip], { type: 'application/zip' }), 'application/zip');
      if (outcome !== 'cancelled') message.textContent = `XML を出力しました（${files.map((f) => f.name.replace('.XML', '')).join('、')}）`;
    } catch (e) {
      showError(error, e);
    }
  };

  const exportDxf = async () => {
    try {
      const info = await saveInfo();
      if (!info) return;
      const fresh = await repository.getProjectSnapshot(projectId);
      const dxf = encodeShiftJis(buildColumnSheetDxf(fresh.points));
      const outcome = await saveFile(`${baseName}_簡易貫入柱状図_${fileTimestamp()}.dxf`, new Blob([dxf], { type: 'application/dxf' }), 'application/dxf');
      if (outcome !== 'cancelled') message.textContent = '柱状図（DXF）を出力しました';
    } catch (e) {
      showError(error, e);
    }
  };

  return h('section', { class: 'card delivery-card' },
    h('h2', { class: 'card-heading' }, '電子納品データ（XML・柱状図）'),
    h('p', { class: 'hint' }, '簡易動的コーン貫入試験データシート交換用データ（JGS 1433、地点ごとの XML）と、簡易貫入柱状図（DXF）を作ります。'),
    dbButton,
    dbResult,
    ...fields,
    measured.length
      ? h('p', { class: 'hint' }, `対象：${measured.map((p) => `K-${p.point.pointNumber}`).join('、')}` + (unmeasured.length ? `（未測定の ${unmeasured.map((p) => `K-${p.point.pointNumber}`).join('、')} は含みません）` : ''))
      : h('p', { class: 'notice' }, '記録のある地点がありません。'),
    measured.length ? h('button', { type: 'button', class: 'btn btn-primary', 'data-export': 'xml', onclick: () => void exportXml() }, `XML を出力（${measured.length} 地点・ZIP）`) : null,
    measured.length ? h('button', { type: 'button', class: 'btn btn-primary', 'data-export': 'dxf', onclick: () => void exportDxf() }, '柱状図を出力（DXF）') : null,
    h('p', { class: 'hint' }, 'DXF は AutoCAD・Jw_cad 等で開けます。DWG が必要な場合は AutoCAD で開いて「名前を付けて保存」から DWG 形式で保存してください。'),
    error,
    message,
  );
}
