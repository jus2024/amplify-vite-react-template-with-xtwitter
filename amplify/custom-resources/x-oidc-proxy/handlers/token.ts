import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import type { IdTokenPayload } from './types.js';
import { exchangeToken, fetchUserInfo } from './utils/x-api.js';
import { generateIdToken } from './utils/jwt.js';

const ssmClient = new SSMClient({});
const dynamoClient = new DynamoDBClient({});

function parseFormBody(body: string | null): Record<string, string> {
  if (!body) return {};
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const issuerUrl = process.env.ISSUER_URL ?? '';
  const xClientId = process.env.X_CLIENT_ID ?? '';
  const xClientSecret = process.env.X_CLIENT_SECRET ?? '';
  const ssmPrivateKeyName = process.env.SSM_PRIVATE_KEY_NAME ?? '';
  const keyId = process.env.KEY_ID ?? '';
  const pkceTableName = process.env.PKCE_TABLE_NAME ?? '';

  // 1. Cognito からの form-urlencoded リクエストをパース
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : event.body ?? '';
  const params = parseFormBody(body);

  const code = params['code'];
  const redirectUri = params['redirect_uri'];
  const clientId = params['client_id'] || xClientId;
  const clientSecret = params['client_secret'] || xClientSecret;

  // ★ DynamoDB から code_verifier を取得（Callback Proxy が保存したもの）
  let codeVerifier = params['code_verifier'] ?? '';
  if (!codeVerifier && code && pkceTableName) {
    try {
      const result = await dynamoClient.send(
        new GetItemCommand({
          TableName: pkceTableName,
          Key: { state: { S: `code:${code}` } },
        }),
      );
      codeVerifier = result.Item?.code_verifier?.S ?? '';
      if (codeVerifier) {
        // 使用済みの code_verifier を削除
        await dynamoClient.send(
          new DeleteItemCommand({
            TableName: pkceTableName,
            Key: { state: { S: `code:${code}` } },
          }),
        );
      }
    } catch { /* code_verifier 取得失敗 */ }
  }

  if (!code || !redirectUri) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_request', error_description: 'Missing code or redirect_uri' }),
    };
  }

  // 2. X にトークン交換
  // ★ redirect_uri は認可時にプロキシの /callback を使用したため、同じ URL を指定
  const xRedirectUri = `${issuerUrl}/callback`;
  const tokenResponse = await exchangeToken(code, xRedirectUri, clientId, clientSecret, codeVerifier);
  const accessToken = tokenResponse.access_token;

  // 3. X Users API からユーザー情報取得
  const userInfo = await fetchUserInfo(accessToken);
  const userId = userInfo.data.id;
  const username = userInfo.data.username;

  // 4. SSM から RSA 秘密鍵を取得（ID トークン署名用）
  const ssmResponse = await ssmClient.send(
    new GetParameterCommand({ Name: ssmPrivateKeyName, WithDecryption: true }),
  );
  const privateKeyJwk = JSON.parse(ssmResponse.Parameter?.Value ?? '') as JsonWebKey;

  // 5. ID トークン生成（RS256 署名）
  const now = Math.floor(Date.now() / 1000);
  const idTokenPayload: IdTokenPayload = {
    sub: userId,
    iss: issuerUrl,
    aud: clientId,
    exp: now + 3600,
    iat: now,
    // ★ X の confirmed_email があればそれを使用、なければダミーメールを生成
    email: userInfo.data.confirmed_email || `${username}@x-user.local`,
    preferred_username: username,
    name: userInfo.data.name,
    picture: userInfo.data.profile_image_url,
  };

  const idToken = await generateIdToken(idTokenPayload, privateKeyJwk, keyId);

  // 6. Cognito に OIDC トークンレスポンスを返却
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: tokenResponse.expires_in,
      id_token: idToken,
      scope: tokenResponse.scope,
    }),
  };
};