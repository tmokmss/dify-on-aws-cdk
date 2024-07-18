import * as cdk from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { IFunction, IVersion, Runtime, Version } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { AwsCustomResource, PhysicalResourceId, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { join } from 'path';

const StackRegion = 'us-east-1';

interface UsEast1StackProps extends cdk.StackProps {}

export class UsEast1Stack extends cdk.Stack {
  private readonly functionVersionParameter: StringParameter;

  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, { env: { region: StackRegion }, ...props });

    const authFunction = new NodejsFunction(this, 'AuthFunction@Edge', {
      runtime: Runtime.NODEJS_20_X,
      entry: join('lib', 'constructs', 'api', 'lambda', 'auth-furl.ts'),
      bundling: {},
    });
    authFunction.currentVersion;
    this.functionVersionParameter = new StringParameter(this, 'FunctionVersion', {
      stringValue: authFunction.currentVersion.edgeArn,
    });

    const statement = new PolicyStatement();
    const edgeLambdaServicePrincipal = new ServicePrincipal('edgelambda.amazonaws.com');
    statement.addPrincipals(edgeLambdaServicePrincipal);
    statement.addActions(edgeLambdaServicePrincipal.assumeRoleAction);
    (authFunction.role as Role).assumeRolePolicy!.addStatements(statement);
  }

  public versionArn(scope: Construct) {
    const id = `VersionArn${this.functionVersionParameter.node.addr}`;
    const existing = cdk.Stack.of(scope).node.tryFindChild(id) as IVersion;
    if (existing) {
      return existing;
    }

    const lookup = new AwsCustomResource(cdk.Stack.of(scope), `Lookup${id}`, {
      onUpdate: {
        // will also be called for a CREATE event
        service: 'SSM',
        action: 'getParameter',
        parameters: {
          Name: this.functionVersionParameter.parameterName,
        },
        // it is impossible to know when the parameter is updated.
        // so we need to get the value on every deployment.
        physicalResourceId: PhysicalResourceId.of(`${Date.now()}`),
        region: StackRegion,
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [this.functionVersionParameter.parameterArn],
      }),
    });
    return Version.fromVersionArn(cdk.Stack.of(scope), id, lookup.getResponseField('Parameter.Value'));
  }
}
