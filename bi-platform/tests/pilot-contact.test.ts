import { describe, expect, it } from 'vitest';
import { PILOT_EMAIL, pilotSection } from '@/config/contact';
import en from '@/i18n/home.en';
import lt from '@/i18n/home.lt';
import pl from '@/i18n/home.pl';

describe('pilot contact: an invitation is shown only when the owner has published a valid contact', () => {
  it('no contact configured → the block is a plan, never an invitation', () => {
    for (const e of ['', '   ', 'not-an-address', 'a@b', '@x.lt', 'a b@c.lt', '<x>@c.lt']) expect(pilotSection(e)).toEqual({ mode: 'plan' });
  });
  it('a valid public contact → an invitation with a mailto link to exactly that address', () => {
    expect(pilotSection(' pilotai@example.lt ')).toEqual({ mode: 'invite', email: 'pilotai@example.lt', mailto: 'mailto:pilotai@example.lt' });
  });
  it('the shipped configuration is either empty or a valid address – never a placeholder', () => {
    expect(PILOT_EMAIL === '' || pilotSection(PILOT_EMAIL).mode === 'invite').toBe(true);
    expect(PILOT_EMAIL).not.toMatch(/example|test|your|noreply/i);
  });
  it('the invitation asks nobody to send financial files, in every language', () => {
    expect(en['home.pilot.contact.safe']).toMatch(/do not send financial files/i);
    expect(lt['home.pilot.contact.safe']).toMatch(/nesiųsti finansinių failų/);
    expect(pl['home.pilot.contact.safe']).toMatch(/nie wysyłać plików finansowych/);
  });
  it('the plan heading does not invite or promise a signup, and the dead-end "no channel" sentence is gone', () => {
    for (const d of [en, lt, pl] as Record<string, string>[]) {
      expect(Object.keys(d)).not.toContain('home.pilot.note');
      expect(d['home.pilot.title.plan']).not.toMatch(/ieškome|szukamy|looking for|registr|sign/i);
    }
  });
});
