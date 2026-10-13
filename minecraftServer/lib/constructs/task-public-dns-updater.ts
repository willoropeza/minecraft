import * as path from 'path'
import * as cdk from 'aws-cdk-lib/core'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import { Construct } from 'constructs'

export interface TaskPublicDnsUpdaterProps {
  readonly service: ecs.FargateService
  readonly hostedZone: route53.IHostedZone
  readonly recordName: string
  readonly ttl?: cdk.Duration
}

export class TaskPublicDnsUpdater extends Construct {
  constructor(scope: Construct, id: string, props: TaskPublicDnsUpdaterProps) {
    super(scope, id)

    const normalizedRecordName = props.recordName.toLowerCase().replace(/\.$/, '')
    const recordTtl = props.ttl ?? cdk.Duration.seconds(30)

    const updaterFunction = new nodejs.NodejsFunction(this, 'Function', {
      entry: path.join(__dirname, '..', '..', 'lambda', 'dnsUpdater', 'index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      environment: {
        HOSTED_ZONE_ID: props.hostedZone.hostedZoneId,
        RECORD_NAME: normalizedRecordName,
        RECORD_TTL: String(recordTtl.toSeconds()),
      },
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    updaterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:DescribeNetworkInterfaces'],
        resources: ['*'],
      }),
    )

    updaterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['route53:ChangeResourceRecordSets'],
        resources: [props.hostedZone.hostedZoneArn],
        conditions: {
          'ForAllValues:StringEquals': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': [normalizedRecordName],
            'route53:ChangeResourceRecordSetsRecordTypes': ['A'],
            'route53:ChangeResourceRecordSetsActions': ['UPSERT'],
          },
        },
      }),
    )

    new events.Rule(this, 'TaskRunningRule', {
      description: `Point ${normalizedRecordName} at the Minecraft server task's public IP`,
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [props.service.cluster.clusterArn],
          group: [`service:${props.service.serviceName}`],
          lastStatus: ['RUNNING'],
          desiredStatus: ['RUNNING'],
        },
      },
      targets: [new targets.LambdaFunction(updaterFunction, { retryAttempts: 3 })],
    })
  }
}
