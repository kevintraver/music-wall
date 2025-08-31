import crypto from 'crypto';

export let codeVerifier = '';

// PKCE helpers
export function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

export function setCodeVerifier(verifier: string) {
  codeVerifier = verifier;
}

export function getCodeVerifier() {
  return codeVerifier;
}