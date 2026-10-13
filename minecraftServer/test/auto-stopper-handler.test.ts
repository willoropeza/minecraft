import { type UpdateServiceCommand } from '@aws-sdk/client-ecs'
import {
  createHandler,
  type ServiceUpdater,
  type TaskStoppedDetail,
  type TaskStoppedEvent,
} from '../lambda/autoStopper/index'

const SELF_EXIT_DETAIL: TaskStoppedDetail = {
  taskArn: 'arn:aws:ecs:us-east-1:363234579155:task/minecraft/abc123',
  stopCode: 'EssentialContainerExited',
  stoppedReason: 'Essential container in task exited',
  containers: [{ exitCode: 0 }],
}

describe('autoStopper handler', () => {
  let sentCommands: UpdateServiceCommand[]
  let recordingEcsClient: ServiceUpdater

  beforeEach(() => {
    sentCommands = []
    recordingEcsClient = {
      send: async (command) => {
        sentCommands.push(command)

        return {}
      },
    }
    process.env.CLUSTER_NAME = 'minecraft-cluster'
    process.env.SERVICE_NAME = 'minecraft-service'
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('sets desiredCount to 0 after a clean self-exit', async () => {
    await createHandler({ ecsClient: recordingEcsClient })(buildStoppedEvent())

    expect(sentCommands).toHaveLength(1)
    expect(sentCommands[0].input).toEqual({
      cluster: 'minecraft-cluster',
      service: 'minecraft-service',
      desiredCount: 0,
    })
  })

  test('ignores a task stopped by a deployment', async () => {
    const deploymentStop = buildStoppedEvent({ stopCode: 'ServiceScheduleInitiated' })

    await createHandler({ ecsClient: recordingEcsClient })(deploymentStop)

    expect(sentCommands).toHaveLength(0)
  })

  test('ignores a crash', async () => {
    const crash = buildStoppedEvent({ containers: [{ exitCode: 1 }] })

    await createHandler({ ecsClient: recordingEcsClient })(crash)

    expect(sentCommands).toHaveLength(0)
  })

  test('rethrows an ECS failure so Lambda retries', async () => {
    const failingEcsClient: ServiceUpdater = {
      send: async () => {
        throw new Error('ThrottlingException')
      },
    }

    await expect(
      createHandler({ ecsClient: failingEcsClient })(buildStoppedEvent()),
    ).rejects.toThrow('ThrottlingException')
  })

  test('fails loudly when configuration is missing', async () => {
    delete process.env.SERVICE_NAME

    await expect(
      createHandler({ ecsClient: recordingEcsClient })(buildStoppedEvent()),
    ).rejects.toThrow('Missing environment variable SERVICE_NAME')
    expect(sentCommands).toHaveLength(0)
  })
})

function buildStoppedEvent(detailOverrides: Partial<TaskStoppedDetail> = {}): TaskStoppedEvent {
  return {
    version: '0',
    id: 'test-event',
    'detail-type': 'ECS Task State Change',
    source: 'aws.ecs',
    account: '363234579155',
    time: '2026-10-08T00:00:00Z',
    region: 'us-east-1',
    resources: [],
    detail: { ...SELF_EXIT_DETAIL, ...detailOverrides },
  }
}
