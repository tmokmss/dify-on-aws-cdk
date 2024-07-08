import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as service_discovery from 'aws-cdk-lib/aws-servicediscovery';
import { CfnOutput, CustomResource, Duration } from 'aws-cdk-lib';
import { ApplicationLoadBalancer, ApplicationProtocol, ListenerAction } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
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

    props.allowedCidrs.forEach((cidr) => alb.connections.allowFrom(ec2.Peer.ipv4(cidr), ec2.Port.tcp(80)));


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
