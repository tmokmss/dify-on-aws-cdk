import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageFunction, DockerImageCode, FunctionUrlAuthType, InvokeMode } from 'aws-cdk-lib/aws-lambda';
import { join } from 'path';
import { CloudFrontGateway } from '../api/cloudfront';

export interface WebLambdaServiceProps {
  cfgw: CloudFrontGateway;
  vpc: IVpc;

  imageTag: string;

  /**
   * If true, enable debug outputs
   * @default false
   */
  debug?: boolean;
}

export class WebService extends Construct {
  constructor(scope: Construct, id: string, props: WebLambdaServiceProps) {
    super(scope, id);

    const { cfgw, vpc, debug = false } = props;
    const port = 3000;

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset(join(__dirname, 'docker', 'web'), {
        platform: Platform.LINUX_AMD64,
        buildArgs: {
          DIFY_VERSION: props.imageTag,
        },
      }),
      environment: {
        // The log level for the application. Supported values are `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`
        LOG_LEVEL: debug ? 'DEBUG' : 'ERROR',
        // enable DEBUG mode to output more logs
        DEBUG: debug ? 'true' : 'false',

        // The base URL of console application api server, refers to the Console base URL of WEB service if console domain is different from api or web app domain.
        // example: http://cloud.dify.ai
        CONSOLE_API_URL: "",
        // The URL prefix for Web APP frontend, refers to the Web App base URL of WEB service if web app domain is different from console or api domain.
        // example: http://udify.app
        APP_API_URL: "",

        PORT: port.toString(),
        AWS_LWA_PORT: port.toString(),
      },
      memorySize: 512,
      vpc,
      timeout: Duration.minutes(5),
    });

    // apigw.addLambda(handler, ['/*']);
    props.cfgw.addLambda(
      handler,
      handler.addFunctionUrl({
        invokeMode: InvokeMode.BUFFERED,
      }),
      ['/*'],
    );
  }
}
