import * as path from 'path'
import * as cdk from 'aws-cdk-lib/core'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'
import { CLEAN_EXIT_CODE, SELF_EXIT_STOP_CODE } from '../../lambda/autoStopper/self-exit'
import { Container$ } from '@aws-sdk/client-ecs'

export interface ServiceAutoStopperProps {
  /** The service to scale to zero when its task exits cleanly on its own. */
  readonly service: ecs.FargateService
}

/** Sets a service's desiredCount to 0 when its task exits on its own with code 0, so ECS doesn't restart it. */
export class ServiceAutoStopper extends Construct {
  constructor(scope: Construct, id: string, props: ServiceAutoStopperProps) {
    super(scope, id)

    const autoStopperFunction = new nodejs.NodejsFunction(this, 'Function', {
      entry: path.join(__dirname, '..', '..', 'lambda', 'autoStopper', 'index.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      environment: {
        // The ECS API accepts names where it takes ARNs, and names read better in logs.
        CLUSTER_NAME: props.service.cluster.clusterName,
        SERVICE_NAME: props.service.serviceName,
      },
      logGroup: new logs.LogGroup(this, 'LogGroup', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    autoStopperFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: [props.service.serviceArn],
      }),
    )

    new events.Rule(this, 'TaskExitedRule', {
      description: 'Scale the Minecraft service to 0 after auto-stop',
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [props.service.cluster.clusterArn],
          group: [`service:${props.service.serviceName}`],
          lastStatus: ['STOPPED'],
          stopCode: [SELF_EXIT_STOP_CODE],
          containers: { exitCode: [CLEAN_EXIT_CODE] },
        },
      },
      // Covers failures to deliver the event to Lambda. Errors thrown inside the handler are
      // retired seperately by Lambda's own asynchronous retries.
      targets: [new targets.LambdaFunction(autoStopperFunction, { retryAttempts: 3 })],
    })
  }
}
