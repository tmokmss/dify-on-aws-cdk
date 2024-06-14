import * as cdk from 'aws-cdk-lib';
import { AmazonLinuxCpuType, InstanceClass, InstanceSize, InstanceType, MachineImage, NatProvider, Peer, Port, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer, ApplicationProtocol, ListenerAction } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { Postgres } from './constructs/postgres';
import { Redis } from './constructs/redis';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { WebService } from './constructs/dify-services/web';
import { ApiService } from './constructs/dify-services/api';
import { WorkerService } from './constructs/dify-services/worker';
import { ApiGateway } from './constructs/api-gateway';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

interface DifyOnAwsCdkStackProps extends cdk.StackProps {
  /**
   * 接続可能なIPアドレスの範囲
   * @example ['1.1.1.1/30']
   */
  allowedCidrs: string[];
}

export class DifyOnAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DifyOnAwsCdkStackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'Vpc', {
      natGatewayProvider: NatProvider.instanceV2({
        instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
        machineImage: MachineImage.latestAmazonLinux2023({ cpuType: AmazonLinuxCpuType.ARM_64 }),
      }),
    });

    const ecsCluster = new Cluster(this, 'EcsCluster', {
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

    const alb = new ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnets: vpc.publicSubnets }),
      internetFacing: true,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      open: false,
      defaultAction: ListenerAction.fixedResponse(400),
    });

    props.allowedCidrs.forEach((cidr) => alb.connections.allowFrom(Peer.ipv4(cidr), Port.tcp(80)));

    const apigw = new ApiGateway(this, 'ApiGateway', {
      vpc,
    });

    new WebService(this, 'WebService', {
      vpc,
      cluster: ecsCluster,
      listener,
      albUrl: `http://${alb.loadBalancerDnsName}`,
      apigw,
    });

    new ApiService(this, 'ApiService', {
      vpc,
      cluster: ecsCluster,
      listener,
      albUrl: `http://${alb.loadBalancerDnsName}`,
      postgres,
      redis,
      storageBucket,
    });

    new WorkerService(this, 'WorkerService', {
      vpc,
      cluster: ecsCluster,
      albUrl: `http://${alb.loadBalancerDnsName}`,
      postgres,
      redis,
      storageBucket,
    });
  }
}
