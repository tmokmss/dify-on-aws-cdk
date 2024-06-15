import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as service_discovery from 'aws-cdk-lib/aws-servicediscovery';
import { CfnOutput, CfnResource, CustomResource, Duration } from 'aws-cdk-lib';
import { Architecture, Code, IFunction, Runtime, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { join } from 'path';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { LlrtFunction } from 'cdk-lambda-llrt';

export interface ApiGatewayProps {
  vpc: ec2.IVpc;
  namespace: service_discovery.INamespace;
  allowedCidrs: string[];
}

export class ApiGateway extends Construct implements ec2.IConnectable {
  public readonly api: apigw.HttpApi;
  public readonly url: string;
  private vpcLink: apigw.VpcLink;
  private namespace: service_discovery.INamespace;
  private serviceArnHandler: IFunction;
  connections: ec2.Connections;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    const { vpc } = props;

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
    });
    const vpcLink = new apigw.VpcLink(this, 'VpcLink', {
      vpc,
      securityGroups: [securityGroup],
    });
    this.namespace = props.namespace;
    this.connections = securityGroup.connections;

    const handler = new SingletonFunction(this, 'GetCloudMapServiceArn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      uuid: '82ebb9e7-ed95-4f5b-bd5c-584d8c1ff2ff',
      code: Code.fromInline(`
const response = require('cfn-response');
const sdk = require('@aws-sdk/client-servicediscovery');
const client = new sdk.ServiceDiscoveryClient();

exports.handler = async function (event, context) {
  try {
    console.log(event);
    if (event.RequestType == 'Delete') {
      return await response.send(event, context, response.SUCCESS);
    }
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/servicediscovery/command/ListServicesCommand/
    const namespaceId = event.ResourceProperties.NamespaceId;
    const serviceName = event.ResourceProperties.ServiceName;
    const command = new sdk.ListServicesCommand({
      Filters: [
        {
          Name: "NAMESPACE_ID",
          Values: [
            namespaceId,
          ],
          Condition: "EQ",
        },
      ],
    });
    const res = await client.send(command);
    const service = res.Services.find(service => service.Name == serviceName);
    if (service == null) {
      throw new Error('Service not found.');
    }
    await response.send(event, context, response.SUCCESS, { serviceArn: service.Arn }, service.Id);
  } catch (e) {
    console.log(e);
    await response.send(event, context, response.FAILED);
  }
};
`),
    });
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['servicediscovery:ListServices'],
        resources: ['*'],
      })
    );
    this.serviceArnHandler = handler;

    const authHandler = new LlrtFunction(this, 'AuthHandler', {
      entry: join(__dirname, 'lambda', 'authorizer.ts'),
      environment: {
        ALLOWED_CIDRS: props.allowedCidrs.join(','),
      },
      architecture: Architecture.ARM_64,
    });

    // we just use authorizer for IP address restriction.
    const authorizer = new HttpLambdaAuthorizer('Authorizer', authHandler, {
      responseTypes: [HttpLambdaResponseType.IAM],
      identitySource: [],
      // must disable caching because there's no way to identify users
      resultsCacheTtl: Duration.seconds(0),
    });

    const api = new apigw.HttpApi(this, 'Resource', {
      apiName: 'DifyApiGateway',
      defaultAuthorizer: authorizer,
    });

    this.api = api;
    this.vpcLink = vpcLink;
    this.url = `${api.apiEndpoint}`;

    new CfnOutput(this, 'ApiEndpoint', { value: api.apiEndpoint });
  }

  public addService(cloudMapServiceName: string, ecsService: ecs.IService, paths: string[]) {
    const serviceArn = this.getServiceArn(cloudMapServiceName, ecsService);
    paths = paths.map((path) => path.replace('*', '{proxy+}'));

    paths.forEach((path) =>
      this.api.addRoutes({
        path,
        methods: [apigw.HttpMethod.ANY],
        integration: new CloudMapIntegration(cloudMapServiceName, serviceArn, this.vpcLink.vpcLinkId),
      })
    );
  }

  private getServiceArn(serviceName: string, ecsService: ecs.IService) {
    const resource = new CustomResource(this, `GetServiceArnResult-${serviceName}`, {
      serviceToken: this.serviceArnHandler.functionArn,
      resourceType: 'Custom::GetServiceArn',
      properties: { NamespaceId: this.namespace.namespaceId, ServiceName: serviceName },
    });
    resource.node.addDependency(ecsService);
    return resource.getAttString('serviceArn');
  }
}

export class CloudMapIntegration extends apigw.HttpRouteIntegration {
  private readonly cloudMapServiceArn: string;
  private readonly vpcLinkId: string;
  constructor(id: string, cloudMapServiceArn: string, vpcLinkId: string) {
    super(id);
    this.cloudMapServiceArn = cloudMapServiceArn;
    this.vpcLinkId = vpcLinkId;
  }
  public bind(_: apigw.HttpRouteIntegrationBindOptions): apigw.HttpRouteIntegrationConfig {
    return {
      type: apigw.HttpIntegrationType.HTTP_PROXY,
      connectionId: this.vpcLinkId,
      connectionType: apigw.HttpConnectionType.VPC_LINK,
      payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_1_0,
      uri: this.cloudMapServiceArn,
      method: apigw.HttpMethod.ANY,
    };
  }
}
