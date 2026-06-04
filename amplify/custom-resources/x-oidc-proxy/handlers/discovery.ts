import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { OidcDiscoveryMetadata } from './types.js';

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const issuerUrl = process.env.ISSUER_URL ?? '';

  const metadata: OidcDiscoveryMetadata = {
    issuer: issuerUrl,
    // ★ ポイント: プロキシ自身の /authorize を指定
    // X は openid スコープを拒否し、PKCE 必須、state 長さ制限があるため
    // Authorize Proxy で前処理してから X にリダイレクトする
    authorization_endpoint: `${issuerUrl}/authorize`,
    token_endpoint: `${issuerUrl}/token`,
    userinfo_endpoint: `${issuerUrl}/userinfo`,
    jwks_uri: `${issuerUrl}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'tweet.read', 'users.read', 'offline.access'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
    ],
    claims_supported: [
      'sub', 'iss', 'aud', 'exp', 'iat',
      'preferred_username', 'name', 'picture',
    ],
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  };
};