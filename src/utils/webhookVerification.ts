import crypto from 'crypto';

/**
 * Validates the X-Hub-Signature-256 header from Meta.
 * Uses the App Secret (not page access token).
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
  appSecret: string
): boolean {
  if (!signatureHeader.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuf      = Buffer.from(signatureHeader, 'utf8');
    const expectedBuf = Buffer.from(expected,         'utf8');
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
