import * as cdk from 'aws-cdk-lib';
import { AmazonLinuxCpuType, IVpc, InstanceClass, InstanceSize, InstanceType, MachineImage, NatProvider, Peer, Port, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Postgres } from './constructs/postgres';
import { Redis } from './constructs/redis';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { WebService } from './constructs/dify-services/web';
import { ApiService } from './constructs/dify-services/api';
import { WorkerService } from './constructs/dify-services/worker';
import { ApiGateway } from './constructs/api/api-gateway';
import { NamespaceType } from 'aws-cdk-lib/aws-servicediscovery';

interface DifyOnAwsStackProps extends cdk.StackProps {
  /**
   * The IP address ranges that have access to the app.
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
}

export class DifyOnAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DifyOnAwsStackProps) {
    super(scope, id, props);

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

    const cluster = new Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
      defaultCloudMapNamespace: {
        name: 'dify',
        useForServiceConnect: true,
        type: NamespaceType.HTTP,
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

    const apigw = new ApiGateway(this, 'ApiGateway', {
      vpc,
      namespace: cluster.defaultCloudMapNamespace!,
      allowedCidrs: props.allowedCidrs,
    });

    new WebService(this, 'WebService', {
      cluster,
      apigw,
    });

    const api = new ApiService(this, 'ApiService', {
      cluster,
      apigw,
      postgres,
      redis,
      storageBucket,
    });

    new WorkerService(this, 'WorkerService', {
      cluster,
      postgres,
      redis,
      storageBucket,
      encryptionSecret: api.encryptionSecret,
    });
  }
}
