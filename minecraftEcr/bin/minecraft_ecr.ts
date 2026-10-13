#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core'
import { MinecraftEcrStack } from '../lib/minecraft_ecr-stack'

const app = new cdk.App()

const requireContext = (contextKey: string): string => {
  const contextValue = app.node.tryGetContext(contextKey)
  if (contextValue === undefined || contextValue === '') {
    throw new Error(`Missing required context value: ${contextKey}`)
  }
  return String(contextValue)
}

new MinecraftEcrStack(app, 'MinecraftEcrStack', {
  env: { account: '363234579155', region: 'us-east-1' },
  terminationProtection: true,
  minecraftVersion: requireContext('minecraftVersion'),
  itzgImageTag: requireContext('itzgImageTag'),
  imageRevision: requireContext('imageRevision'),
})

cdk.Tags.of(app).add('project', 'minecraft')
