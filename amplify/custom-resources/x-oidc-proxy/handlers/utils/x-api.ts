import type { XTokenResponse, XUsersResponse } from '../types.js';

const X_TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token';
const X_USERS_ENDPOINT =
  'https://api.x.com/2/users/me?user.fields=id,username,name,profile_image_url,confirmed_email';
const REQUEST_TIMEOUT_MS = 10_000;

/** Basic 認証ヘッダーを生成（X はクライアント認証に Basic 認証を使用） */
export function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string,
): string {
  const credentials = `${clientId}:${clientSecret}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * X トークンエンドポイントに認可コードを送信してアクセストークンを取得する。
 * ★ ポイント: code_verifier を含める（X は PKCE 必須）
 */
export async function exchangeToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  codeVerifier: string,
): Promise<XTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,  // ★ X は PKCE 必須
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(X_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: buildBasicAuthHeader(clientId, clientSecret),
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `X token endpoint returned HTTP ${response.status}: ${errorBody}`,
      );
    }

    return (await response.json()) as XTokenResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** X Users API からユーザー情報を取得する */
export async function fetchUserInfo(
  accessToken: string,
): Promise<XUsersResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(X_USERS_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `X Users API returned HTTP ${response.status}: ${errorBody}`,
      );
    }

    return (await response.json()) as XUsersResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}