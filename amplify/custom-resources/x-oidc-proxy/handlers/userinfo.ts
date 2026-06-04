import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { XUsersResponse } from './types.js';
import { fetchUserInfo } from './utils/x-api.js';

function extractBearerToken(
  headers: Record<string, string | undefined> | null,
): string | null {
  if (!headers) return null;
  // API Gateway がヘッダー名を小文字に正規化する場合があるため case-insensitive で検索
  const authKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === 'authorization',
  );
  if (!authKey) return null;
  const match = headers[authKey]?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const accessToken = extractBearerToken(event.headers);

  if (!accessToken) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_token', error_description: 'Missing Authorization header' }),
    };
  }

  // X Users API からユーザー情報を取得
  const xResponse: XUsersResponse = await fetchUserInfo(accessToken);

  // ★ OIDC UserInfo 形式に変換して返却
  // X の confirmed_email があればそれを使用、なければダミーメールを生成
  const userInfo = {
    sub: xResponse.data.id,
    preferred_username: xResponse.data.username,
    email: xResponse.data.confirmed_email || `${xResponse.data.username}@x-user.local`,
    name: xResponse.data.name,
    picture: xResponse.data.profile_image_url,
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userInfo),
  };
};