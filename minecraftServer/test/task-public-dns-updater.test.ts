import * as cdk from 'aws-cdk-lib/core'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as route53 from 'aws-cdk-lib/aws-route53'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { MinecraftNetwork } from '../lib/constructs/minecraft-network'
import { MinecraftServerService } from '../lib/constructs/minecraft-server-service'
import { MinecraftWorldStorage } from '../lib/constructs/minecraft-world-storage'
import { TaskPublicDnsUpdater } from '../lib/constructs/task-public-dns-updater'
import { Architecture } from 'aws-cdk-lib/aws-lambda'
import { Environment } from 'aws-cdk-lib/aws-appconfig'
import { PolicyDocument } from 'aws-cdk-lib/aws-iam'

describe('TaskPublicDnsUpdater', () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, 'TestStack')
  const network = new MinecraftNetwork(stack, 'Network')
  const worldStorage = new MinecraftWorldStorage(stack, 'WorldStorage', {
    vpc: network.vpc,
  })
  const server = new MinecraftServerService(stack, 'Server', {
    cluster: network.cluster,
    repository: ecr.Repository.fromRepositoryName(stack, 'Repository', 'minecraft-server'),
    storage: worldStorage,
  })
  const hostedZone = route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
    hostedZoneId: 'Z0231589F4WWDQQ1N9V',
    zoneName: 'dev.thirdechelon.io',
  })

  new TaskPublicDnsUpdater(stack, 'DnsUpdater', {
    service: server.service,
    hostedZone,
    recordName: 'MC.dev.thirdechelon.io',
  })
  const template = Template.fromStack(stack)

  test('normalizes the record name for the Lambda', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      Environment: {
        Variables: {
          HOSTED_ZONE_ID: 'Z0231589F4WWDQQ1N9V',
          RECORD_NAME: 'mc.dev.thirdechelon.io',
          RECORD_TTL: '30',
        },
      },
    })
  })

  test('only allows UPSERT of the one A record', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Action: 'route53:ChangeResourceRecordSets',
            Effect: 'Allow',
            Resource: Match.anyValue(),
            Condition: {
              'ForAllValues:StringEquals': {
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['mc.dev.thirdechelon.io'],
                'route53:ChangeResourceRecordSetsRecordTypes': ['A'],
                'route53:ChangeResourceRecordSetsActions': ['UPSERT'],
              },
            },
          },
        ]),
      },
    })
  })

  test('fires when a task of this service reaches a running state', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        source: ['aws.ecs'],
        'detail-type': ['ECS Task State Change'],
        detail: Match.objectLike({
          lastStatus: ['RUNNING'],
          desiredStatus: ['RUNNING'],
        }),
      }),
    })
  })
})
