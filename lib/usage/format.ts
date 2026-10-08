/** Display helpers for the usage screen. */

export function formatCpuTime(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Share used, clamped to 0–100 for a progress bar. */
export function percentUsed(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Bar colour band: calm, then a warning near the limit (the allowance pauses runs at 100 %). */
export function usageTone(percent: number): "ok" | "warning" | "full" {
  if (percent >= 100) return "full";
  return percent >= 80 ? "warning" : "ok";
}
