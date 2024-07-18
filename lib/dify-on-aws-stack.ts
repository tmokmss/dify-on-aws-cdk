import * as cdk from 'aws-cdk-lib';
import {
  AmazonLinuxCpuType,
  IVpc,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  NatProvider,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Postgres } from './constructs/postgres';
import { Redis } from './constructs/redis';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { SandboxService } from './constructs/dify-services/sandbox';
import { WorkerService } from './constructs/dify-services/worker';
import { NamespaceType } from 'aws-cdk-lib/aws-servicediscovery';
import { ApiLambdaService } from './constructs/dify-services/api-lambda';
import { WebLambdaService } from './constructs/dify-services/web-lambda';
import { CloudFrontGateway } from './constructs/api/cloudfront';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { UsEast1Stack } from './us-east-1-stack';

interface DifyOnAwsStackProps extends cdk.StackProps {
  /**
   * The IP address ranges in CIDR notation that have access to the app.
   * @example ['1.1.1.1/30']
   */
  allowedCidrs: string[];

  /**
   * Use t4g.nano NAT instances instead of NAT Gateway.
   * Ignored when you import an existing VPC.
   * @default false
   */
  cheapVpc?: boolean;

  /**
   * If set, it imports the existing VPC instead of creating a new one.
   * The VPC must have one or more public and private subnets.
   * @default create a new VPC
   */
  vpcId?: string;

  /**
   * The image tag to deploy Dify container images (api=worker and web).
   * The images are pulled from [here](https://hub.docker.com/u/langgenius).
   *
   * It is recommended to set this to a fixed version,
   * because otherwise an unexpected version is pulled on a ECS service's scaling activity.
   * @default "latest"
   */
  difyImageTag?: string;

  /**
   * The image tag to deploy the Dify sandbox container image.
   * The image is pulled from [here](https://hub.docker.com/r/langgenius/dify-sandbox/tags).
   *
   * @default "latest"
   */
  difySandboxImageTag?: string;

  usEast1Stack: UsEast1Stack;
}

export class DifyOnAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DifyOnAwsStackProps) {
    super(scope, id, props);

    const { difyImageTag: imageTag = 'latest' } = props;

    let vpc: IVpc;
    if (props.vpcId != null) {
      vpc = Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId });
    } else {
      vpc = new Vpc(this, 'Vpc', {
        ...(props.cheapVpc
          ? {
              natGatewayProvider: NatProvider.instanceV2({
                instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
                machineImage: MachineImage.latestAmazonLinux2023({ cpuType: AmazonLinuxCpuType.ARM_64 }),
              }),
            }
          : {}),
      });
    }

    const cluster = new Cluster(this, 'EcsCluster', {
      vpc,
      containerInsights: true,
      defaultCloudMapNamespace: {
        name: 'difyns',
        // useForServiceConnect: true,
        type: NamespaceType.DNS_PRIVATE,
      },
    });

    const postgres = new Postgres(this, 'Postgres', {
      vpc,
    });

    const redis = new Redis(this, 'Redis', { vpc });

    const storageBucket = new Bucket(this, 'StorageBucket', {
      autoDeleteObjects: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    const cfgw = new CloudFrontGateway(this, 'CFGateway', {
      allowedCidrs: props.allowedCidrs,
      usEast1Stack: props.usEast1Stack,
    });

    const sandbox = new SandboxService(this, 'ApiService', {
      cluster,
      sandboxImageTag: props.difySandboxImageTag ?? 'latest',
    });

    new ApiLambdaService(this, 'ApiLambdaService', {
      vpc,
      cfgw,
      postgres,
      redis,
      storageBucket,
      imageTag,
      sandbox,
    });

    new WebLambdaService(this, 'WebLambdaService', {
      vpc,
      cfgw,
      imageTag,
    });

    new WorkerService(this, 'WorkerService', {
      cluster,
      postgres,
      redis,
      storageBucket,
      encryptionSecret: sandbox.encryptionSecret,
      imageTag,
    });
  }
}
