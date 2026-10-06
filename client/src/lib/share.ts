import { Capacitor } from '@capacitor/core';

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** In the Android app: write to cache and open the share sheet. On the web: share if possible. */
async function nativeShare(blob: Blob, filename: string, title: string) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const file = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
  await Share.share({ title, files: [file.uri] });
}

export async function shareImage(blob: Blob, filename: string, title = 'NivoTalk') {
  if (Capacitor.isNativePlatform()) return nativeShare(blob, filename, title);
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  downloadBlob(blob, filename);
}

export async function downloadImage(blob: Blob, filename: string) {
  // Android WebViews can't download blobs — the share sheet lets people save to Photos.
  if (Capacitor.isNativePlatform()) return nativeShare(blob, filename, 'Save image');
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
