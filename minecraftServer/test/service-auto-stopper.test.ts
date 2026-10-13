import * as cdk from 'aws-cdk-lib/core'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { MinecraftNetwork } from '../lib/constructs/minecraft-network'
import { MinecraftServerService } from '../lib/constructs/minecraft-server-service'
import { MinecraftWorldStorage } from '../lib/constructs/minecraft-world-storage'
import { ServiceAutoStopper } from '../lib/constructs/service-auto-stopper'

describe('ServiceAutoStopper', () => {
  const template = buildTemplate()

  test('only reacts to the task exiting successfully', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        detail: Match.objectLike({
          lastStatus: ['STOPPED'],
          stopCode: ['EssentialContainerExited'],
          containers: { exitCode: [0] },
        }),
      }),
    })
  })

  test('only update this one service', () => {
    const serviceLogicalId = Object.keys(template.findResources('AWS::ECS::Service'))[0]

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          { Action: 'ecs:UpdateService', Effect: 'Allow', Resource: { Ref: serviceLogicalId } },
        ],
      },
    })
  })
})

function buildTemplate(): Template {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, 'TestStack')
  const network = new MinecraftNetwork(stack, 'Network')
  const worldStorage = new MinecraftWorldStorage(stack, 'WorldStorage', { vpc: network.vpc })
  const server = new MinecraftServerService(stack, 'Server', {
    cluster: network.cluster,
    repository: ecr.Repository.fromRepositoryName(stack, 'Repository', 'minecraft-server'),
    storage: worldStorage,
  })

  new ServiceAutoStopper(stack, 'AutoStopper', { service: server.service })

  return Template.fromStack(stack)
}
