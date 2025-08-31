import crypto from 'crypto';

export let codeVerifier = '';

function base64urlEncode(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// PKCE helpers
export function generateCodeVerifier() {
  // 32 bytes -> 43 char URL-safe string
  const random = crypto.randomBytes(32);
  const v = base64urlEncode(random);
  return v;
}

export function generateCodeChallenge(verifier: string) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64urlEncode(hash);
}

export function setCodeVerifier(verifier: string) {
  codeVerifier = verifier;
}

export function getCodeVerifier() {
  return codeVerifier;
}
