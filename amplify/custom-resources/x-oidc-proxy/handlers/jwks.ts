import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { JwksResponse } from './types.js';
import { exportPublicKeyAsJwk } from './utils/jwt.js';

const ssmClient = new SSMClient({});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const ssmPublicKeyName = process.env.SSM_PUBLIC_KEY_NAME ?? '';
  const keyId = process.env.KEY_ID ?? '';

  // ★ SSM から RSA 公開鍵を取得
  // Cognito は ID トークンの署名検証時にこのエンドポイントを呼び出す
  const ssmResponse = await ssmClient.send(
    new GetParameterCommand({ Name: ssmPublicKeyName }),
  );

  const keyValue = ssmResponse.Parameter?.Value;
  if (!keyValue) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'server_error', error_description: 'Failed to retrieve public key' }),
    };
  }

  const publicKeyJwk = JSON.parse(keyValue) as JsonWebKey;
  const jwkKey = exportPublicKeyAsJwk(publicKeyJwk, keyId);

  const jwksResponse: JwksResponse = { keys: [jwkKey] };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jwksResponse),
  };
};