import { ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs'
import type { EventBridgeEvent } from 'aws-lambda'
import { CLEAN_EXIT_CODE, SELF_EXIT_STOP_CODE } from './self-exit'

interface StoppedContainer {
  readonly exitCode?: number
}

export interface TaskStoppedDetail {
  readonly taskArn: string
  readonly stopCode?: string
  readonly stoppedReason?: string
  readonly containers?: StoppedContainer[]
}

export type TaskStoppedEvent = EventBridgeEvent<'ECS Task State Change', TaskStoppedDetail>

/** The one ECS call this handler makes. A real ECSClient fits this shape; tests pass a fake. */
export interface ServiceUpdater {
  send(command: UpdateServiceCommand): Promise<unknown>
}

export interface AutoStopperDeps {
  readonly ecsClient: ServiceUpdater
}

/** Builds the handler around its dependencies, so tests can run it without AWS. */
export const createHandler =
  (deps: AutoStopperDeps) =>
  async (event: TaskStoppedEvent): Promise<void> => {
    const clusterName = readRequiredEnv('CLUSTER_NAME')
    const serviceName = readRequiredEnv('SERVICE_NAME')
    const taskArn = event.detail.taskArn

    if (!isCleanSelfExit(event.detail)) {
      // The EventBridge rule already filters these out, so this only runs if the rule changes.
      // Returning instead of throwing stops Lambda from retrying an event that can never qualify.
      console.log(`Ignoring task ${taskArn}: it did not exit on its own with code 0`)

      return
    }

    console.log(
      `Task ${taskArn} exited on its own (${event.detail.stoppedReason ?? 'no reason given'})`,
    )

    try {
      await deps.ecsClient.send(
        new UpdateServiceCommand({ cluster: clusterName, service: serviceName, desiredCount: 0 }),
      )
    } catch (err) {
      console.error(
        `Could not scale ${serviceName} to 0: ${err instanceof Error ? err.message : 'unknown'}`,
      )

      throw err
    }

    console.log(`Set ${serviceName} desiredCount to 0`)
  }

export const handler = createHandler({ ecsClient: new ECSClient({}) })

function readRequiredEnv(variableName: string): string {
  const variableValue = process.env[variableName]

  if (!variableValue) {
    throw new Error(`Missing environment variable ${variableName}`)
  }

  return variableValue
}

function isCleanSelfExit(taskDetail: TaskStoppedDetail): boolean {
  const hasCleanExitCode =
    taskDetail.containers?.some((container) => container.exitCode === CLEAN_EXIT_CODE) ?? false

  return taskDetail.stopCode === SELF_EXIT_STOP_CODE && hasCleanExitCode
}
