import { Construct } from 'constructs';
import { CfnOutput, CfnResource, Duration, Stack } from 'aws-cdk-lib';
import { IFunction, IFunctionUrl } from 'aws-cdk-lib/aws-lambda';
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  CfnOriginAccessControl,
  Distribution,
  LambdaEdgeEventType,
  OriginRequestPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { UsEast1Stack } from '../../us-east-1-stack';

export interface CloudFrontGatewayProps {
  allowedCidrs: string[];
  usEast1Stack: UsEast1Stack;
}

export class CloudFrontGateway extends Construct {
  public readonly urlParameter: StringParameter;
  public readonly url: string;
  private readonly distribution: Distribution;
  private readonly usEast1Stack: UsEast1Stack;
  private readonly oac: CfnOriginAccessControl;
  private originCount: number = 1;

  constructor(scope: Construct, id: string, props: CloudFrontGatewayProps) {
    super(scope, id);

    this.usEast1Stack = props.usEast1Stack;

    const distribution = new Distribution(this, 'FrontendDistribution', {
      comment: 'Dify Distribution',
      defaultBehavior: {
        origin: new HttpOrigin('www.example.com'),
      },
      errorResponses: [{ httpStatus: 404, responsePagePath: '/', responseHttpStatus: 200 }],
      // logBucket: accessLogsBucket,
    });
    this.distribution = distribution;

    const url = `https://${this.distribution.domainName}`;
    this.url = 'aa';
    this.urlParameter = new StringParameter(this, 'Url', { stringValue: 'dummy' });

    new AwsCustomResource(this, 'UpdateUrlParameter', {
      onUpdate: {
        // will also be called for a CREATE event
        service: 'SSM',
        action: 'putParameter',
        parameters: {
          Name: this.urlParameter.parameterName,
          Overwrite: true,
          Value: url,
        },
        physicalResourceId: PhysicalResourceId.of(url),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [this.urlParameter.parameterArn],
      }),
    });

    this.oac = new CfnOriginAccessControl(this, 'LambdaOac', {
      originAccessControlConfig: {
        name: `OAC for lambda fURL(${this.node.addr})`,
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    new CfnOutput(this, 'Endpoint', { value: url });
  }

  public addLambda(handler: IFunction, furl: IFunctionUrl, paths: string[]) {
    handler.addPermission('AllowCloudFrontServicePrincipal', {
      principal: new ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunctionUrl',
      sourceArn: `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${this.distribution.distributionId}`,
    });
    const cachePolicy = new CachePolicy(this, `CachePolicy${handler.node.addr}`, {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList(
        'authorization',
        'Origin',
        'X-HTTP-Method-Override',
        'X-HTTP-Method',
        'X-Method-Override',
      ),
      defaultTtl: Duration.seconds(0),
      cookieBehavior: CacheCookieBehavior.all(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });
    const origin = new FunctionUrlOrigin(furl);

    const cfnDistribution = this.distribution.node.defaultChild as CfnResource;

    cfnDistribution.addPropertyOverride(
      `DistributionConfig.Origins.${this.originCount++}.OriginAccessControlId`,
      this.oac.attrId,
    );

    paths.forEach((path) =>
      this.distribution.addBehavior(path, origin, {
        cachePolicy,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        edgeLambdas: [
          {
            functionVersion: this.usEast1Stack.versionArn(handler),
            eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
            includeBody: true,
          },
        ],
      }),
    );
  }
}
