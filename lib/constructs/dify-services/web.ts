import { CpuArchitecture, FargateTaskDefinition, ICluster } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { Duration, aws_ecs as ecs } from 'aws-cdk-lib';
import { Port } from 'aws-cdk-lib/aws-ec2';
import { ApiGateway } from '../api/api-gateway';

export interface WebServiceProps {
  cluster: ICluster;
  apigw: ApiGateway;

  /**
   * If true, enable debug outputs
   * @default false
   */
  debug?: boolean;
}

export class WebService extends Construct {
  constructor(scope: Construct, id: string, props: WebServiceProps) {
    super(scope, id);

    const { cluster, apigw, debug = false } = props;
    const mappingName = 'web';
    const port = 3000;

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
        LOG_LEVEL: debug ? 'DEBUG' : 'ERROR',
        // enable DEBUG mode to output more logs
        DEBUG: debug ? 'true' : 'false',

        // The base URL of console application api server, refers to the Console base URL of WEB service if console domain is different from api or web app domain.
        // example: http://cloud.dify.ai
        CONSOLE_API_URL: apigw.url,
        // The URL prefix for Web APP frontend, refers to the Web App base URL of WEB service if web app domain is different from console or api domain.
        // example: http://udify.app
        APP_API_URL: apigw.url,

        // Set host to 0.0.0.0 seems necessary for ECS Service Connect to work.
        // https://nextjs.org/docs/pages/api-reference/next-config-js/output
        HOSTNAME: '0.0.0.0',
        PORT: port.toString(),
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'log',
      }),
      portMappings: [{ containerPort: port, name: mappingName }],
      healthCheck: {
        // use wget instead of curl due to alpine: https://stackoverflow.com/questions/47722898/how-can-i-make-a-docker-healthcheck-with-wget-instead-of-curl
        command: ['CMD-SHELL', `wget --no-verbose --tries=1 --spider http://localhost:${port}/ || exit 1`],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
      },
    });

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
      serviceConnectConfiguration: {
        services: [
          {
            portMappingName: mappingName,
          },
        ],
        logDriver: ecs.LogDriver.awsLogs({
          streamPrefix: 'log',
        }),
      },
      enableExecuteCommand: true,
    });
    service.node.addDependency(cluster.defaultCloudMapNamespace!);
    service.connections.allowFrom(apigw, Port.tcp(port));

    apigw.addService(mappingName, service, ['/*']);
  }
}
