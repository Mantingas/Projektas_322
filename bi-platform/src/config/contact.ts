/**
 * Public contact for pilot enquiries – decided by the owner, NOT by the code.
 * Leave empty until the owner has chosen the address to publish: an empty value means the page shows the pilot as a plan, with no invitation to apply.
 * Never put a personal address here without the owner's explicit approval; this value is published to every visitor.
 */
export const PILOT_EMAIL = '';

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

/** What the pilot block may show: an invitation only when a valid public contact exists. */
export function pilotSection(email: string): { mode: 'invite'; email: string; mailto: string } | { mode: 'plan' } {
  const e = email.trim();
  return EMAIL.test(e) ? { mode: 'invite', email: e, mailto: `mailto:${e}` } : { mode: 'plan' };
}
