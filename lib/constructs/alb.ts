import { Duration } from 'aws-cdk-lib';
import { IVpc, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import { FargateService, IService } from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  ListenerAction,
  ListenerCondition,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface AlbProps {
  vpc: IVpc;
  allowedCidrs: string[];
}

export class Alb extends Construct {
  public url: string;

  private listenerPriority = 1;
  private listener: ApplicationListener;
  private vpc: IVpc;

  constructor(scope: Construct, id: string, props: AlbProps) {
    super(scope, id);

    const { vpc } = props;

    const alb = new ApplicationLoadBalancer(this, 'Resource', {
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

    this.vpc = vpc;
    this.listener = listener;
    this.url = `http://${alb.loadBalancerDnsName}`;
  }

  public addEcsService(id: string, ecsService: FargateService, port: number, healthCheckPath: string, paths: string[]) {
    const group = new ApplicationTargetGroup(this, `${id}TargetGroup`, {
      vpc: this.vpc,
      targets: [ecsService],
      protocol: ApplicationProtocol.HTTP,
      port: port,
      deregistrationDelay: Duration.seconds(10),
      healthCheck: {
        path: healthCheckPath,
        interval: Duration.seconds(15),
        healthyHttpCodes: '200-299,307',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 6,
      },
    });
    // a condition only accepts an array with up to 5 elements
    // https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-limits.html
    for (let i = 0; i < Math.floor((paths.length + 4) / 5); i++) {
      const slice = paths.slice(i * 5, (i + 1) * 5);
      console.log(slice);
      this.listener.addTargetGroups(`${id}${i}`, {
        targetGroups: [group],
        conditions: [ListenerCondition.pathPatterns(slice)],
        priority: this.listenerPriority++,
      });
    }
  }
}
