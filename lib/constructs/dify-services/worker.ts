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

export interface WorkerServiceProps {
  cluster: ICluster;
  vpc: IVpc;
  albUrl: string;

  postgres: Postgres;
  redis: Redis;
  storageBucket: IBucket;
}

export class WorkerService extends Construct {
  constructor(scope: Construct, id: string, props: WorkerServiceProps) {
    super(scope, id);

    const { vpc, cluster, postgres, albUrl, redis, storageBucket } = props;

    const taskDefinition = new FargateTaskDefinition(this, 'Task', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
    });

    taskDefinition.addContainer('Main', {
      image: ecs.ContainerImage.fromRegistry(`langgenius/dify-api`),
      environment: {
        MODE: 'worker',
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
        // The configurations of redis connection.
        // It is consistent with the configuration in the 'redis' service below.
        REDIS_HOST: redis.endpoint,
        REDIS_PORT: redis.port.toString(),
        REDIS_USE_SSL: 'true',
        // use redis db 0 for redis cache
        REDIS_DB: '0',
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
      },
      // healthCheck: {
      //   command: ['CMD-SHELL', 'curl -f http://localhost:5001/health || exit 1'],
      //   interval: Duration.seconds(15),
      //   startPeriod: Duration.seconds(30),
      //   timeout: Duration.seconds(5),
      //   retries: 3,
      // },
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
  }
}
