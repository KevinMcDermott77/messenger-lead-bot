/**
 * Normalises and validates Irish and UK phone numbers.
 * Returns E.164 format (+353... or +44...) or null if invalid.
 */
export function normalisePhone(raw: string): string | null {
  if (!raw) return null;

  // Strip everything except digits and leading +
  let phone = raw.replace(/[^\d+]/g, '');

  // 00 prefix → +
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);

  // Irish mobile 08x → +3538x
  if (/^08\d{8}$/.test(phone)) phone = '+353' + phone.slice(1);

  // Irish landline 0[1-9]x → +353
  if (/^0[1-9]\d{7,8}$/.test(phone)) phone = '+353' + phone.slice(1);

  // UK mobile 07x → +447x
  if (/^07\d{9}$/.test(phone)) phone = '+44' + phone.slice(1);

  // UK landline 01/02x → +44
  if (/^0[12]\d{9}$/.test(phone)) phone = '+44' + phone.slice(1);

  // Validate final E.164 format
  const isValid = /^\+?(353\d{9}|353\d{8}|44\d{10})$/.test(phone.replace('+', ''));
  return isValid ? phone : null;
}

export function isValidPhone(raw: string): boolean {
  return normalisePhone(raw) !== null;
}
