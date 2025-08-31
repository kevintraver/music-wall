// Simple in-memory token store for server-side API usage
// Tokens are set during admin OAuth callback and used by API routes

export interface ServerTokens {
  accessToken: string;
  refreshToken?: string;
}

let serverTokens: ServerTokens = { accessToken: '', refreshToken: '' };

export function setServerTokens(tokens: Readonly<ServerTokens>): void {
  serverTokens = {
    accessToken: tokens.accessToken || serverTokens.accessToken,
    refreshToken: tokens.refreshToken ?? serverTokens.refreshToken,
  };
}

export function getServerTokens(): Readonly<ServerTokens> {
  return serverTokens;
}

