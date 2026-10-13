import { DescribeNetworkInterfacesCommand, EC2Client } from '@aws-sdk/client-ec2'
import {
  ChangeResourceRecordSetsCommand,
  ResourceRecord$,
  Route53Client,
} from '@aws-sdk/client-route-53'
import { mockClient } from 'aws-sdk-client-mock'
import { handler, TaskStateChangeEvent } from '../lambda/dnsUpdater/index'
import { Resource } from 'aws-cdk-lib'

const ec2Mock = mockClient(EC2Client)
const route53Mock = mockClient(Route53Client)

const buildEvent = (networkInterfaceId?: string): TaskStateChangeEvent => ({
  version: '0',
  id: 'test-event',
  'detail-type': 'ECS Task State Change',
  source: 'aws.ecs',
  account: '363234579155',
  time: '2026-10-08T00:00:00Z',
  region: 'us-east-1',
  resources: [],
  detail: {
    taskArn: 'arn:aws:ecs:us-east-1:363234579155:task/minecraft/abc123',
    attachments: networkInterfaceId
      ? [
          {
            type: 'eni',
            details: [{ name: 'networkInterfaceId', value: networkInterfaceId }],
          },
        ]
      : [],
  },
})

describe('dnsUpdater handler', () => {
  beforeEach(() => {
    ec2Mock.reset()
    route53Mock.reset()
    process.env.HOSTED_ZONE_ID = 'Z0231589F4WWDQQ1N9V'
    process.env.RECORD_NAME = 'mc.dev.thirdechelon.io'
    process.env.RECORD_TTL = '30'
  })

  test('upserts the A record with the task public IP', async () => {
    ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({
      NetworkInterfaces: [{ Association: { PublicIp: '203.0.113.10' } }],
    })
    route53Mock.on(ChangeResourceRecordSetsCommand).resolves({})

    const publicIp = await handler(buildEvent('eni-0123456789abcdef0'))

    expect(publicIp).toBe('203.0.113.10')
    const changeCalls = route53Mock.commandCalls(ChangeResourceRecordSetsCommand)
    expect(changeCalls).toHaveLength(1)
    const recordSet = changeCalls[0].args[0].input.ChangeBatch?.Changes?.[0].ResourceRecordSet
    expect(recordSet).toEqual({
      Name: 'mc.dev.thirdechelon.io',
      Type: 'A',
      TTL: 30,
      ResourceRecords: [{ Value: '203.0.113.10' }],
    })
  })

  test('fails when the task has no ENI', async () => {
    await expect(handler(buildEvent())).rejects.toThrow('No ENI attached')
    expect(route53Mock.commandCalls(ChangeResourceRecordSetsCommand)).toHaveLength(0)
  })

  test('fails when the ENI has no public IP', async () => {
    ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({ NetworkInterfaces: [{}] })
    await expect(handler(buildEvent('eni-0123456789abcdef0'))).rejects.toThrow('has no public IP')
  })
})
