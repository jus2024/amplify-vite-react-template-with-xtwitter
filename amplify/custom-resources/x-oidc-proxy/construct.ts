/**
 * X (Twitter) OIDC プロキシ CDK コンストラクト
 *
 * 作成するリソース:
 * - API Gateway REST API（6 エンドポイント）
 * - Lambda 関数 × 6（Discovery, Authorize, Callback, Token, UserInfo, JWKS）
 * - DynamoDB テーブル（PKCE state 管理）
 * - IAM ロール（Lambda 用、SSM 読み取り + DynamoDB 読み書き権限）
 */

import { Construct } from 'constructs';
import {
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  aws_lambda_nodejs as nodejs,
  aws_lambda as lambda,
  aws_apigateway as apigateway,
  aws_ssm as ssm,
  aws_dynamodb as dynamodb,
} from 'aws-cdk-lib';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface XOidcProxyConstructProps {
  xClientId: string;
  xClientSecret: string;
  keyId?: string;
}

export class XOidcProxyConstruct extends Construct {
  public readonly issuerUrl: string;

  constructor(scope: Construct, id: string, props: XOidcProxyConstructProps) {
    super(scope, id);

    const keyId = props.keyId ?? 'x-oidc-proxy-key-1';

    // ★ SSM Parameter Store パラメータ名
    const privateKeyParamName = `/x-oidc-proxy/${id}/private-key`;
    const publicKeyParamName = `/x-oidc-proxy/${id}/public-key`;

    const privateKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'RsaPrivateKey', { parameterName: privateKeyParamName },
    );
    const publicKeyParam = ssm.StringParameter.fromStringParameterName(
      this, 'RsaPublicKey', publicKeyParamName,
    );

    // ★ DynamoDB テーブル（PKCE state / code_verifier 管理）
    // X は PKCE 必須だが Cognito は送信しないため、プロキシ側で管理する
    const pkceTable = new dynamodb.Table(this, 'PkceTable', {
      partitionKey: { name: 'state', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // __dirname equivalent for ESM
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const handlersDir = path.join(currentDir, 'handlers');

    // ★ API Gateway — Cognito が issuerUrl としてアクセスするエンドポイント
    const api = new apigateway.RestApi(this, 'XOidcProxyApi', {
      restApiName: 'X OIDC Proxy',
      description: 'OIDC proxy for X (Twitter) OAuth 2.0 integration with Cognito',
      deployOptions: { stageName: 'prod' },
    });

    // ★ issuerUrl を restApiId + region から構築（循環依存を回避）
    const region = Stack.of(this).region;
    const issuerUrl = Fn.join('', [
      'https://', api.restApiId, '.execute-api.', region, '.amazonaws.com/prod',
    ]);
    this.issuerUrl = issuerUrl;

    const commonBundling: nodejs.BundlingOptions = {
      format: nodejs.OutputFormat.ESM,
      mainFields: ['module', 'main'],
      sourceMap: true,
    };

    // Discovery Lambda
    const discoveryFn = new nodejs.NodejsFunction(this, 'DiscoveryFunction', {
      entry: path.join(handlersDir, 'discovery.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(5),
      environment: { ISSUER_URL: issuerUrl },
      bundling: commonBundling,
    });

    // ★ Authorize Proxy Lambda
    // openid スコープ除去 + PKCE 生成 + state 短縮
    const authorizeFn = new nodejs.NodejsFunction(this, 'AuthorizeFunction', {
      entry: path.join(handlersDir, 'authorize.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(5),
      environment: {
        PKCE_TABLE_NAME: pkceTable.tableName,
        ISSUER_URL: issuerUrl,
      },
      bundling: commonBundling,
    });

    // ★ Callback Proxy Lambda
    // X からのコールバックを受け取り、元の state を復元して Cognito にリダイレクト
    const callbackFn = new nodejs.NodejsFunction(this, 'CallbackFunction', {
      entry: path.join(handlersDir, 'callback.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(5),
      environment: { PKCE_TABLE_NAME: pkceTable.tableName },
      bundling: commonBundling,
    });

    // Token Proxy Lambda
    const tokenFn = new nodejs.NodejsFunction(this, 'TokenFunction', {
      entry: path.join(handlersDir, 'token.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {
        ISSUER_URL: issuerUrl,
        X_CLIENT_ID: props.xClientId,
        X_CLIENT_SECRET: props.xClientSecret,
        SSM_PRIVATE_KEY_NAME: privateKeyParamName,
        KEY_ID: keyId,
        PKCE_TABLE_NAME: pkceTable.tableName,
      },
      bundling: commonBundling,
    });

    // UserInfo Proxy Lambda
    const userInfoFn = new nodejs.NodejsFunction(this, 'UserInfoFunction', {
      entry: path.join(handlersDir, 'userinfo.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      environment: { ISSUER_URL: issuerUrl },
      bundling: commonBundling,
    });

    // JWKS Lambda
    const jwksFn = new nodejs.NodejsFunction(this, 'JwksFunction', {
      entry: path.join(handlersDir, 'jwks.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: {
        SSM_PUBLIC_KEY_NAME: publicKeyParam.parameterName,
        KEY_ID: keyId,
      },
      bundling: commonBundling,
    });

    // ★ IAM 権限
    privateKeyParam.grantRead(tokenFn);
    publicKeyParam.grantRead(jwksFn);
    pkceTable.grantWriteData(authorizeFn);
    pkceTable.grantReadWriteData(callbackFn);
    pkceTable.grantReadWriteData(tokenFn);

    // ★ API Gateway エンドポイント（6 ルート）
    const wellKnown = api.root.addResource('.well-known');
    wellKnown.addResource('openid-configuration')
      .addMethod('GET', new apigateway.LambdaIntegration(discoveryFn));

    api.root.addResource('authorize')
      .addMethod('GET', new apigateway.LambdaIntegration(authorizeFn));

    api.root.addResource('callback')
      .addMethod('GET', new apigateway.LambdaIntegration(callbackFn));

    api.root.addResource('token')
      .addMethod('POST', new apigateway.LambdaIntegration(tokenFn));

    api.root.addResource('userinfo')
      .addMethod('GET', new apigateway.LambdaIntegration(userInfoFn));

    api.root.addResource('jwks')
      .addMethod('GET', new apigateway.LambdaIntegration(jwksFn));
  }
}