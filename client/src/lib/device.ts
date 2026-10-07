/** A random id for this browser / installed app, so the server knows which devices have received a message. */
let memo: string | null = null;

export function deviceId() {
  if (memo) return memo;
  try {
    memo = localStorage.getItem('nivo.device');
    if (!memo) {
      memo = crypto.randomUUID().replace(/-/g, '');
      localStorage.setItem('nivo.device', memo);
    }
  } catch {
    memo ??= crypto.randomUUID().replace(/-/g, '');
  }
  return memo;
}
