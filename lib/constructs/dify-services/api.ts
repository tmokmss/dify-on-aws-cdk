import { CpuArchitecture, FargateTaskDefinition, ICluster } from 'aws-cdk-lib/aws-ecs';
import { ApplicationListener, ApplicationProtocol, ApplicationTargetGroup, ListenerCondition } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { CfnOutput, Duration, Stack, aws_ecs as ecs } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IRole, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Postgres } from '../postgres';
import { Redis } from '../redis';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { join } from 'path';

export interface ApiServiceProps {
  cluster: ICluster;
  vpc: IVpc;
  listener: ApplicationListener;
  albUrl: string;
  postgres: Postgres;
  redis: Redis;
  storageBucket: IBucket;
}

export class ApiService extends Construct {
  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);

    const { vpc, cluster, listener, postgres, albUrl, redis, storageBucket } = props;

    const taskDefinition = new FargateTaskDefinition(this, 'Task', {
      cpu: 1024,
      // 512だとOOMが起きたので、増やした
      memoryLimitMiB: 2048,
      runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
    });

    const apiKeySecret = new Secret(this, 'ApiKey', {
      generateSecretString: {
        passwordLength: 30, // Oracle password cannot have more than 30 characters
      },
    });

    taskDefinition.addContainer('Main', {
      image: ecs.ContainerImage.fromRegistry(`langgenius/dify-api`),
      environment: {
        MODE: 'api',
        // The log level for the application. Supported values are `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`
        LOG_LEVEL: 'DEBUG',
        // enable DEBUG mode to output more logs
        DEBUG: 'true',
        // The base URL of console application web frontend, refers to the Console base URL of WEB service if console domain is
        // different from api or web app domain.
        // example: http://cloud.dify.ai
        CONSOLE_WEB_URL: albUrl,
        // The base URL of console application api server, refers to the Console base URL of WEB service if console domain is different from api or web app domain.
        // example: http://cloud.dify.ai
        CONSOLE_API_URL: albUrl,
        // The URL prefix for Service API endpoints, refers to the base URL of the current API service if api domain is different from console domain.
        // example: http://api.dify.ai
        SERVICE_API_URL: albUrl,
        // The URL prefix for Web APP frontend, refers to the Web App base URL of WEB service if web app domain is different from console or api domain.
        // example: http://udify.app
        APP_WEB_URL: albUrl,
        // When enabled, migrations will be executed prior to application startup and the application will start after the migrations have completed.
        MIGRATION_ENABLED: 'true',
        // The configurations of redis connection.
        // It is consistent with the configuration in the 'redis' service below.
        REDIS_HOST: redis.endpoint,
        REDIS_PORT: redis.port.toString(),
        REDIS_USE_SSL: 'true',
        // use redis db 0 for redis cache
        REDIS_DB: '0',
        // Specifies the allowed origins for cross-origin requests to the Web API, e.g. https://dify.app or * for all origins.
        WEB_API_CORS_ALLOW_ORIGINS: '*',
        // Specifies the allowed origins for cross-origin requests to the console API, e.g. https://cloud.dify.ai or * for all origins.
        CONSOLE_CORS_ALLOW_ORIGINS: '*',
        // CSRF Cookie settings
        // Controls whether a cookie is sent with cross-site requests,
        // providing some protection against cross-site request forgery attacks

        // Default: `SameSite=Lax, Secure=false, HttpOnly=true`,
        // This default configuration supports same-origin requests using either HTTP or HTTPS,
        // but does not support cross-origin requests. It is suitable for local debugging purposes.

        // If you want to enable cross-origin support,
        // you must use the HTTPS protocol and set the configuration to `SameSite=None, Secure=true, HttpOnly=true`.

        // The type of storage to use for storing user files. Supported values are `local` and `s3` and `azure-blob` and `google-storage`, Default: ,`local`
        STORAGE_TYPE: 's3',
        // The S3 storage configurations, only available when STORAGE_TYPE is `s3`.
        S3_BUCKET_NAME: storageBucket.bucketName,
        S3_REGION: Stack.of(storageBucket).region,

        DB_DATABASE: postgres.databaseName,
        // The type of vector store to use. Supported values are `weaviate`, `qdrant`, `milvus`, `relyt`.
        VECTOR_STORE: 'pgvector',
        // pgvector configurations
        PGVECTOR_DATABASE: 'dify',
        // // Mail configuration, support: resend, smtp,
        // MAIL_TYPE: '',
        // // default send from email address, if not specified
        // MAIL_DEFAULT_SEND_FROM: 'YOUR EMAIL FROM (eg: no-reply <no-reply@dify.ai>)',
        // SMTP_SERVER: '',
        // SMTP_PORT: 587,
        // SMTP_USERNAME: '',
        // SMTP_PASSWORD: '',
        // SMTP_USE_TLS: 'true',
        // The sandbox service endpoint.
        CODE_EXECUTION_ENDPOINT: 'http://localhost:8194', // Fargate の task 内通信は localhost 宛,
        CODE_MAX_NUMBER: '9223372036854775807',
        CODE_MIN_NUMBER: '-9223372036854775808',
        CODE_MAX_STRING_LENGTH: '80000',
        TEMPLATE_TRANSFORM_MAX_LENGTH: '80000',
        CODE_MAX_STRING_ARRAY_LENGTH: '30',
        CODE_MAX_OBJECT_ARRAY_LENGTH: '30',
        CODE_MAX_NUMBER_ARRAY_LENGTH: '1000',
        // Indexing configuration
        INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: '1000',

        SECRET_KEY: 'dummy',
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'log',
      }),
      portMappings: [{ containerPort: 5001 }],
      secrets: {
        // The configurations of postgres database connection.
        // It is consistent with the configuration in the 'db' service below.
        DB_USERNAME: ecs.Secret.fromSecretsManager(postgres.secret, 'username'),
        DB_HOST: ecs.Secret.fromSecretsManager(postgres.secret, 'host'),
        DB_PORT: ecs.Secret.fromSecretsManager(postgres.secret, 'port'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(postgres.secret, 'password'),
        PGVECTOR_USER: ecs.Secret.fromSecretsManager(postgres.secret, 'username'),
        PGVECTOR_HOST: ecs.Secret.fromSecretsManager(postgres.secret, 'host'),
        PGVECTOR_PORT: ecs.Secret.fromSecretsManager(postgres.secret, 'port'),
        PGVECTOR_PASSWORD: ecs.Secret.fromSecretsManager(postgres.secret, 'password'),
        REDIS_PASSWORD: ecs.Secret.fromSecretsManager(redis.secret),
        CELERY_BROKER_URL: ecs.Secret.fromSsmParameter(redis.brokerUrl),
        CODE_EXECUTION_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:5001/health || exit 1'],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
      },
    });

    taskDefinition.addContainer('Sandbox', {
      image: ecs.ContainerImage.fromAsset(join(__dirname, 'docker'), { file: 'sandbox.Dockerfile', platform: Platform.LINUX_AMD64 }),
      environment: {
        GIN_MODE: 'release',
        WORKER_TIMEOUT: '15',
        ENABLE_NETWORK: 'true',
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'log',
      }),
      portMappings: [{ containerPort: 8194 }],
      secrets: {
        API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret),
      },
    });

    storageBucket.grantReadWrite(taskDefinition.taskRole);
    // we can use IAM role once this issue will be closed
    // https://github.com/langgenius/dify/issues/3471
    taskDefinition.taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );

    // Service
    const ecsService = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',
          weight: 0,
        },
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 1,
        },
      ],
      vpcSubnets: vpc.selectSubnets({
        subnets: vpc.privateSubnets,
      }),
      enableExecuteCommand: true,
    });

    ecsService.connections.allowToDefaultPort(postgres);
    ecsService.connections.allowToDefaultPort(redis);
    const group = new ApplicationTargetGroup(this, 'Group', {
      vpc,
      targets: [ecsService],
      protocol: ApplicationProtocol.HTTP,
      port: 5001,
      deregistrationDelay: Duration.seconds(10),
      healthCheck: {
        path: '/health',
        interval: Duration.seconds(15),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 4,
      },
    });

    const paths = ['/console/api', '/api', '/v1', '/files'];

    listener.addTargetGroups('Api', {
      targetGroups: [group],
      conditions: [ListenerCondition.pathPatterns(paths)],
      priority: 10,
    });

    listener.addTargetGroups('ApiWildcard', {
      targetGroups: [group],
      conditions: [ListenerCondition.pathPatterns(paths.map((p) => `${p}/*`))],
      priority: 11,
    });
  }
}
