/**
 * ファイルを端末に保存する。
 * スマートフォン・iPad では共有シート（「ファイルに保存」「Google ドライブ」「メール」等）を開き、
 * PC ではダウンロードする。
 * 戻り値：'shared'（共有完了）/ 'downloaded'（ダウンロード開始）/ 'cancelled'（共有シートを閉じた）
 */
export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

export async function saveTextFile(fileName: string, content: string, mimeType: string): Promise<SaveOutcome> {
  return saveFile(fileName, new Blob([content], { type: mimeType }), mimeType);
}

export async function saveFile(fileName: string, blob: Blob, mimeType: string): Promise<SaveOutcome> {
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (isTouchDevice && typeof navigator.canShare === 'function') {
    const file = new File([blob], fileName, { type: mimeType });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName });
        return 'shared';
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        // 共有に失敗した場合はダウンロードで保存する
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

/** ファイル名に使えない文字を置き換える */
export function safeFileName(text: string): string {
  return text.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

/** "20260930-1830" */
export function fileTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
