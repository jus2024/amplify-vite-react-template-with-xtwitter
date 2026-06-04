import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomBytes, createHash, randomUUID } from 'crypto';

const X_AUTHORIZE_ENDPOINT = 'https://x.com/i/oauth2/authorize';
const PKCE_TTL_SECONDS = 600; // 10 分

const dynamoClient = new DynamoDBClient({});

/** RFC 7636 準拠の code_verifier を生成 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** code_verifier から code_challenge を生成（S256） */
function generateCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.PKCE_TABLE_NAME ?? '';
  const issuerUrl = process.env.ISSUER_URL ?? '';

  const params = new URLSearchParams();
  if (event.queryStringParameters) {
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      if (value !== undefined) {
        params.set(key, value);
      }
    }
  }

  // ★ ポイント1: scope から openid を除去（X は openid スコープを拒否する）
  const scope = params.get('scope') ?? '';
  const filteredScopes = scope
    .split(/[\s+]+/)
    .filter((s) => s !== 'openid' && s.length > 0)
    .join(' ');

  if (filteredScopes.length > 0) {
    params.set('scope', filteredScopes);
  } else {
    params.delete('scope');
  }

  // ★ ポイント2: PKCE を生成（X は PKCE 必須だが Cognito は送信しない）
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  params.set('code_challenge', codeChallenge);
  params.set('code_challenge_method', 'S256');

  // ★ ポイント3: Cognito の長い state を短い UUID に置き換え
  // X は state が 700 文字以上だと拒否する
  const originalState = params.get('state') ?? '';
  const originalRedirectUri = params.get('redirect_uri') ?? '';
  const shortState = randomUUID();
  params.set('state', shortState);

  // redirect_uri をプロキシの /callback に差し替え
  params.set('redirect_uri', `${issuerUrl}/callback`);

  // DynamoDB に保存（Callback Proxy と Token Proxy で使用）
  if (tableName) {
    const ttl = Math.floor(Date.now() / 1000) + PKCE_TTL_SECONDS;
    await dynamoClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          state: { S: shortState },
          code_verifier: { S: codeVerifier },
          original_state: { S: originalState },
          original_redirect_uri: { S: originalRedirectUri },
          ttl: { N: String(ttl) },
        },
      }),
    );
  }

  return {
    statusCode: 302,
    headers: { Location: `${X_AUTHORIZE_ENDPOINT}?${params.toString()}` },
    body: '',
  };
};