import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as service_discovery from 'aws-cdk-lib/aws-servicediscovery';
import { CfnOutput, Duration } from 'aws-cdk-lib';

export interface ApiGatewayProps {
  vpc: ec2.IVpc;
}

export class ApiGateway extends Construct {
  public readonly api: apigw.HttpApi;
  private vpcLink: apigw.VpcLink;
  private cloudMapService: service_discovery.Service;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    const { vpc } = props;
    const vpcLink = new apigw.VpcLink(this, 'VpcLink', {
      vpc,
    });

    const privateDnsNamespace = new service_discovery.PrivateDnsNamespace(this, 'Namespace', {
      vpc,
      name: 'dify',
    });

    const cloudMapService = privateDnsNamespace.createService('CloudMapService', {
      name: 'EcsDiscoveryService',
      dnsRecordType: service_discovery.DnsRecordType.SRV,
      dnsTtl: Duration.seconds(60),
      // customHealthCheck: {
      //   failureThreshold: 1,
      // },
    });
    this.cloudMapService = cloudMapService;

    const api = new apigw.HttpApi(this, 'Resource', {});
    this.api = api;
    this.vpcLink = vpcLink;

    new CfnOutput(this, 'ApiEndpoint', { value: api.apiEndpoint });
  }

  public addService(id: string, service: ecs.FargateService, path: string, port: number) {
    path = path.replace('*', '{proxy+}');

    service.associateCloudMapService({
      service: this.cloudMapService,
      containerPort: port,
    });

    this.api.addRoutes({
      path,
      methods: [apigw.HttpMethod.ANY],
      integration: new CloudMapIntegration(id, this.cloudMapService.serviceArn, this.vpcLink.vpcLinkId),
    });
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
