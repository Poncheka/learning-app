// Says when something happens, the way a person would: "at 3:40 PM" or "tomorrow at 3:40 PM".
export function whenOpens(iso: string | null | undefined): string {
  if (!iso) return 'tomorrow';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'tomorrow';
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  return sameDay ? `at ${time}` : `tomorrow at ${time}`;
}
