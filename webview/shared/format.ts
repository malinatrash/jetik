const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** IntelliJ-style dates: "Today 14:02", "Yesterday 09:15", otherwise date and time. */
export function formatDate(ms: number, now = new Date()): string {
  const date = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const clock = time.format(date);
  if (ms >= startOfToday) return `Today ${clock}`;
  if (ms >= startOfToday - 86_400_000) return `Yesterday ${clock}`;
  return `${day.format(date)} ${clock}`;
}

export const shortHash = (hash: string): string => hash.slice(0, 8);

export const classes = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');
