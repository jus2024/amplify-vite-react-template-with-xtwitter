import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.PKCE_TABLE_NAME ?? '';

  const code = event.queryStringParameters?.['code'] ?? '';
  const shortState = event.queryStringParameters?.['state'] ?? '';
  const error = event.queryStringParameters?.['error'] ?? '';

  // エラーの場合はそのまま Cognito にリダイレクト
  if (error) {
    let originalState = shortState;
    let originalRedirectUri = '';

    if (shortState && tableName) {
      try {
        const result = await dynamoClient.send(
          new GetItemCommand({
            TableName: tableName,
            Key: { state: { S: shortState } },
          }),
        );
        originalState = result.Item?.original_state?.S ?? shortState;
        originalRedirectUri = result.Item?.original_redirect_uri?.S ?? '';
      } catch { /* DynamoDB エラーの場合はそのまま返す */ }
    }

    if (originalRedirectUri) {
      const errorDescription = event.queryStringParameters?.['error_description'] ?? '';
      const params = new URLSearchParams({
        error,
        ...(errorDescription && { error_description: errorDescription }),
        state: originalState,
      });
      return {
        statusCode: 302,
        headers: { Location: `${originalRedirectUri}?${params.toString()}` },
        body: '',
      };
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error, error_description: 'Authorization failed' }),
    };
  }

  if (!code || !shortState) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_request', error_description: 'Missing code or state' }),
    };
  }

  // ★ DynamoDB から元の state、redirect_uri、code_verifier を取得
  let originalState = shortState;
  let originalRedirectUri = '';
  let codeVerifier = '';

  if (tableName) {
    try {
      const result = await dynamoClient.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { state: { S: shortState } },
        }),
      );
      originalState = result.Item?.original_state?.S ?? shortState;
      originalRedirectUri = result.Item?.original_redirect_uri?.S ?? '';
      codeVerifier = result.Item?.code_verifier?.S ?? '';
    } catch {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'server_error', error_description: 'Failed to retrieve session' }),
      };
    }
  }

  if (!originalRedirectUri) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_request', error_description: 'Session not found or expired' }),
    };
  }

  // ★ code → code_verifier のマッピングを DynamoDB に保存
  // Token Proxy が後でトークン交換時に code_verifier を取得するために使用
  if (code && codeVerifier && tableName) {
    const ttl = Math.floor(Date.now() / 1000) + 300; // 5 分
    await dynamoClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          state: { S: `code:${code}` },
          code_verifier: { S: codeVerifier },
          ttl: { N: String(ttl) },
        },
      }),
    );
  }

  // 元の state を復元して Cognito にリダイレクト
  const params = new URLSearchParams({ code, state: originalState });

  return {
    statusCode: 302,
    headers: { Location: `${originalRedirectUri}?${params.toString()}` },
    body: '',
  };
};