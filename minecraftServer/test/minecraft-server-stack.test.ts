import * as cdk from 'aws-cdk-lib/core'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { MinecraftServerStack } from '../lib/minecraft_server-stack'
import { Capacity } from 'aws-cdk-lib/aws-dynamodb'

describe('MinecraftServerStack', () => {
  const app = new cdk.App()
  const stack = new MinecraftServerStack(app, 'TestServerStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    zoneName: 'dev.thirdechelon.io',
    recordName: 'mc.dev.thirdechelon.io',
    spot: true,
  })
  const template = Template.fromStack(stack)

  test('uses the two named Availability Zones', () => {
    template.hasResourceProperties('AWS::EC2::Subnet', {
      AvailabilityZone: 'us-east-1a',
    })
    template.hasResourceProperties('AWS::EC2::Subnet', {
      AvailabilityZone: 'us-east-1b',
    })
  })

  test('outputs the VPC id', () => {
    template.hasOutput('VpcId', {})
  })

  test('has exactly one retained file system', () => {
    template.resourceCountIs('AWS::EFS::FileSystem', 1)
    template.hasResource('AWS::EFS::FileSystem', { DeletionPolicy: 'Retain' })
  })

  test('reads the repository name from SSM', () => {
    template.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/minecraft/ecr/repository-name',
    })
  })

  test('reads the hosted zone id from SSM', () => {
    template.hasParameter('*', {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/minecraft/dns/hosted-zone-id',
    })
  })

  test('passes the spot flag', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }],
    })
  })

  test('writes the cluster and service name to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/minecraft/server/cluster-name',
    })
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/minecraft/server/service-name',
    })
  })

  test('has the DNS updater and auto-stopper rules', () => {
    template.resourceCountIs('AWS::Events::Rule', 2)
  })

  test('outputs the server address', () => {
    template.hasOutput('ServerAddress', { Value: 'mc.dev.thirdechelon.io' })
  })

  test('outputs the start command', () => {
    template.hasOutput('StartCommand', { Value: Match.anyValue() })
  })
})
