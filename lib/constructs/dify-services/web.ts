import { CpuArchitecture, FargateTaskDefinition, ICluster } from 'aws-cdk-lib/aws-ecs';
import { ApplicationListener, ApplicationProtocol, ApplicationTargetGroup, ListenerCondition } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { Duration, aws_ecs as ecs } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { INamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { ApiGateway } from '../api-gateway';

export interface SampleAppServiceProps {
  cluster: ICluster;
  vpc: IVpc;
  albUrl: string;
  listener: ApplicationListener;
  apigw: ApiGateway;

  /**
   * If set to true, add an ADOT sidecar
   * @default false
   */
  enableAdot?: boolean;
}

export class WebService extends Construct {
  constructor(scope: Construct, id: string, props: SampleAppServiceProps) {
    super(scope, id);

    const { vpc, cluster, listener, albUrl, apigw } = props;

    const taskDefinition = new FargateTaskDefinition(this, 'Task', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
    });

    taskDefinition.addContainer('Main', {
      image: ecs.ContainerImage.fromRegistry(`langgenius/dify-web`),
      environment: {
        MODE: 'api',
        // The log level for the application. Supported values are `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`
        LOG_LEVEL: 'DEBUG',
        // enable DEBUG mode to output more logs
        DEBUG: 'true',
        // The base URL of console application api server, refers to the Console base URL of WEB service if console domain is different from api or web app domain.
        // example: http://cloud.dify.ai
        CONSOLE_API_URL: albUrl,
        // The URL prefix for Web APP frontend, refers to the Web App base URL of WEB service if web app domain is different from console or api domain.
        // example: http://udify.app
        APP_API_URL: albUrl,
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'log',
      }),
      portMappings: [{ containerPort: 3000, name: 'web' }],
      // healthCheck: {
      //   command: ['CMD-SHELL', 'curl -f http://localhost:3000/ || exit 1'],
      //   interval: Duration.seconds(15),
      //   startPeriod: Duration.seconds(30),
      //   timeout: Duration.seconds(5),
      //   retries: 3,
      // },
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
      enableExecuteCommand: true,
    });

    apigw.addService('Web', service, '/*', 3000);

    return;
    const group = new ApplicationTargetGroup(this, 'Group', {
      vpc,
      targets: [service],
      protocol: ApplicationProtocol.HTTP,
      deregistrationDelay: Duration.seconds(10),
      port: 3000,
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-299,307',
        interval: Duration.seconds(15),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
    });

    listener.addTargetGroups('Web', {
      targetGroups: [group],
      conditions: [ListenerCondition.pathPatterns(['/*'])],
      priority: 13,
    });
  }
}
