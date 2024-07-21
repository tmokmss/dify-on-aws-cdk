import { CpuArchitecture, FargateTaskDefinition, ICluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { aws_ecs as ecs } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { join } from 'path';
import { Connections, IConnectable, Port } from 'aws-cdk-lib/aws-ec2';

export interface ApiServiceProps {
  cluster: ICluster;
  sandboxImageTag: string;
}

export class SandboxService extends Construct implements IConnectable {
  public readonly sandboxEndpoint: string;
  public readonly encryptionSecret: Secret;
  connections: Connections;

  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);

    const { cluster } = props;
    const port = 8194;

    const taskDefinition = new FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
    });

    const encryptionSecret = new Secret(this, 'EncryptionSecret', {
      generateSecretString: {
        passwordLength: 42,
      },
    });
    this.encryptionSecret = encryptionSecret;

    taskDefinition.addContainer('Sandbox', {
      image: ecs.ContainerImage.fromAsset(join(__dirname, 'docker', 'sandbox'), {
        platform: Platform.LINUX_AMD64,
        buildArgs: {
          DIFY_VERSION: props.sandboxImageTag,
        },
      }),
      environment: {
        GIN_MODE: 'release',
        WORKER_TIMEOUT: '15',
        ENABLE_NETWORK: 'true',
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'log',
      }),
      portMappings: [{ containerPort: port }],
      secrets: {
        API_KEY: ecs.Secret.fromSecretsManager(encryptionSecret),
      },
    });

    // Service
    const service = new ecs.FargateService(this, 'FargateService', {
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
      cloudMapOptions: {
        name: 'sandbox',
      },
      enableExecuteCommand: true,
    });
    this.connections = new Connections({
      defaultPort: Port.tcp(port),
      securityGroups: service.connections.securityGroups,
    });
    this.sandboxEndpoint = `http://${service.cloudMapService!.serviceName}.${
      cluster.defaultCloudMapNamespace!.namespaceName
    }:${port}`;
  }
}
