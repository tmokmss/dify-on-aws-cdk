import { CpuArchitecture, FargateTaskDefinition, ICluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Duration, aws_ecs as ecs, Stack } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { join } from 'path';
import { Connections, IConnectable, IVpc, Port } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { DockerImageFunction, DockerImageCode, InvokeMode } from 'aws-cdk-lib/aws-lambda';
import { CloudFrontGateway } from '../api/cloudfront';

export interface ApiServiceProps {
  cfgw: CloudFrontGateway;
  imageTag: string;
}

export class SandboxService extends Construct {
  public readonly sandboxEndpoint: string;
  public readonly encryptionSecret: Secret;

  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);

    const endpointPrefix = 'DIFY_SANDBOX';

    const secret = new Secret(this, 'Secret', {
      generateSecretString: {
        passwordLength: 42,
      },
    });
    this.encryptionSecret = secret;

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset(join(__dirname, 'docker', 'sandbox'), {
        platform: Platform.LINUX_AMD64,
        buildArgs: {
          DIFY_VERSION: props.imageTag,
        },
      }),
      environment: {
        GIN_MODE: 'release',
        WORKER_TIMEOUT: '850', // in seconds
        ENABLE_NETWORK: 'true',
        API_KEY: secret.secretValue.unsafeUnwrap(),
      },
      memorySize: 1769,
      timeout: Duration.minutes(15),
    });

    const paths = [`/${endpointPrefix}`];
    props.cfgw.addLambda(handler, handler.addFunctionUrl({}), [...paths, ...paths.map((p) => `${p}/*`)]);
  }
}
