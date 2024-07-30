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
import { WebService } from './constructs/dify-services/web';
import { ApiService } from './constructs/dify-services/api';
import { WorkerService } from './constructs/dify-services/worker';
import { Alb } from './constructs/alb';
import { PublicHostedZone } from 'aws-cdk-lib/aws-route53';

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
   * The domain name you use for Dify's service URL.
   * You must own a Route53 public hosted zone for the domain in your account.
   * @default No custom domain is used.
   */
  domainName?: string;

  /**
   * The ID of Route53 hosted zone for the domain.
   * @default No custom domain is used.
   */
  hostedZoneId?: string;

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
}

export class DifyOnAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DifyOnAwsStackProps) {
    super(scope, id, props);

    const { difyImageTag: imageTag = 'latest', difySandboxImageTag: sandboxImageTag = 'latest' } = props;

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
              natGateways: 1,
            }
          : {}),
        maxAzs: 2,
      });
    }

    if ((props.hostedZoneId != null) !== (props.domainName != null)) {
      throw new Error(`You have to set both hostedZoneId and domainName! Or leave both blank.`);
    }

    const hostedZone =
      props.domainName && props.hostedZoneId
        ? PublicHostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            zoneName: props.domainName,
            hostedZoneId: props.hostedZoneId,
          })
        : undefined;

    const cluster = new Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
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

    const alb = new Alb(this, 'Alb', { vpc, allowedCidrs: props.allowedCidrs, hostedZone });

    const api = new ApiService(this, 'ApiService', {
      cluster,
      alb,
      postgres,
      redis,
      storageBucket,
      imageTag,
      sandboxImageTag,
    });

    new WebService(this, 'WebService', {
      cluster,
      alb,
      imageTag,
    });

    new WorkerService(this, 'WorkerService', {
      cluster,
      postgres,
      redis,
      storageBucket,
      encryptionSecret: api.encryptionSecret,
      imageTag,
    });

    new cdk.CfnOutput(this, 'DifyUrl', {
      value: alb.url,
    });
  }
}
