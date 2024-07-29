import { CpuArchitecture, FargateTaskDefinition, ICluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Duration, Stack, aws_ecs as ecs } from 'aws-cdk-lib';
import { Connections, IConnectable, IVpc, Port } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Postgres } from '../postgres';
import { Redis } from '../redis';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { join } from 'path';
import { DockerImageCode, DockerImageFunction, FunctionUrlAuthType, InvokeMode } from 'aws-cdk-lib/aws-lambda';
import { CloudFrontGateway } from '../api/cloudfront';
import { SandboxService } from './sandbox';

export interface ApiServiceProps {
  cfgw: CloudFrontGateway;
  vpc: IVpc;

  postgres: Postgres;
  redis: Redis;
  storageBucket: IBucket;
  sandbox: SandboxService;

  imageTag: string;

  /**
   * If true, enable debug outputs
   * @default false
   */
  debug?: boolean;
}

export class ApiLambdaService extends Construct {
  public readonly encryptionSecret: Secret;

  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);

    const { vpc, cfgw, postgres, redis, storageBucket, sandbox, debug = false } = props;

    const encryptionSecret = new Secret(this, 'EncryptionSecret', {
      generateSecretString: {
        passwordLength: 42,
      },
    });
    this.encryptionSecret = encryptionSecret;

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset(join(__dirname, 'docker', 'api'), {
        platform: Platform.LINUX_AMD64,
        buildArgs: {
          DIFY_VERSION: props.imageTag,
        },
      }),
      environment: {
        MODE: 'api',
        // avoid writing files to directories outside of /tmp
        TRANSFORMERS_CACHE: '/tmp/.cache',
        MPLCONFIGDIR: '/tmp/.config',
        // The log level for the application. Supported values are `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`
        LOG_LEVEL: debug ? 'DEBUG' : 'ERROR',
        // enable DEBUG mode to output more logs
        DEBUG: debug ? 'true' : 'false',

        // When enabled, migrations will be executed prior to application startup and the application will start after the migrations have completed.
        // MIGRATION_ENABLED: 'true',

        CLOUDFRONT_URL_PARAMETER: cfgw.urlParameter.parameterName,

        // The configurations of redis connection.
        REDIS_HOST: redis.endpoint,
        REDIS_PORT: redis.port.toString(),
        REDIS_USE_SSL: 'true',
        REDIS_DB: '0',

        // Specifies the allowed origins for cross-origin requests to the Web API, e.g. https://dify.app or * for all origins.
        WEB_API_CORS_ALLOW_ORIGINS: '*',
        // Specifies the allowed origins for cross-origin requests to the console API, e.g. https://cloud.dify.ai or * for all origins.
        CONSOLE_CORS_ALLOW_ORIGINS: '*',

        // The type of storage to use for storing user files.
        STORAGE_TYPE: 's3',
        S3_BUCKET_NAME: storageBucket.bucketName,
        S3_REGION: Stack.of(storageBucket).region,

        // postgres settings. the credentials are in secrets property.
        DB_DATABASE: postgres.databaseName,

        // pgvector configurations
        VECTOR_STORE: 'pgvector',
        PGVECTOR_DATABASE: postgres.pgVectorDatabaseName,

        // The sandbox service endpoint.
        CODE_EXECUTION_ENDPOINT: sandbox.sandboxEndpoint,

        // The configurations of postgres database connection.
        // It is consistent with the configuration in the 'db' service below.
        DB_USERNAME: postgres.secret.secretValueFromJson('username').unsafeUnwrap(),
        DB_HOST: postgres.secret.secretValueFromJson('host').unsafeUnwrap(),
        DB_PORT: postgres.secret.secretValueFromJson('port').unsafeUnwrap(),
        DB_PASSWORD: postgres.secret.secretValueFromJson('password').unsafeUnwrap(),
        PGVECTOR_USER: postgres.secret.secretValueFromJson('username').unsafeUnwrap(),
        PGVECTOR_HOST: postgres.secret.secretValueFromJson('host').unsafeUnwrap(),
        PGVECTOR_PORT: postgres.secret.secretValueFromJson('port').unsafeUnwrap(),
        PGVECTOR_PASSWORD: postgres.secret.secretValueFromJson('password').unsafeUnwrap(),
        REDIS_PASSWORD: redis.secret.secretValue.unsafeUnwrap(),
        CELERY_BROKER_URL: redis.brokerUrl.stringValue,
        SECRET_KEY: encryptionSecret.secretValue.unsafeUnwrap(),
        CODE_EXECUTION_API_KEY: sandbox.encryptionSecret.secretValue.unsafeUnwrap(), // is it ok to reuse this?
      },
      memorySize: 1769,
      vpc,
      timeout: Duration.minutes(5),
    });

    storageBucket.grantReadWrite(handler);
    sandbox.connections.allowDefaultPortFrom(handler);
    cfgw.urlParameter.grantRead(handler);

    // we can use IAM role once this issue will be closed
    // https://github.com/langgenius/dify/issues/3471
    handler.role!.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );

    handler.connections.allowToDefaultPort(postgres);
    handler.connections.allowToDefaultPort(redis);

    const paths = ['/console/api', '/api', '/v1', '/files'];
    props.cfgw.addLambda(
      handler,
      handler.addFunctionUrl({
        invokeMode: InvokeMode.RESPONSE_STREAM,
      }),
      [...paths, ...paths.map((p) => `${p}/*`)],
    );
  }
  connections: Connections;
}
