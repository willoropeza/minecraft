#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MinecraftServerStack } from '../lib/minecraft_server-stack';

const app = new cdk.App();

const requireContext = (contextKey: string): string => {
  const contextValue = app.node.tryGetContext(contextKey);
  if (contextValue === undefined || contextValue === '') {
    throw new Error(`Missing required context value: ${contextKey}`);
  }
  return String(contextValue);
};

new MinecraftServerStack(app, 'MinecraftServerStack', {
  env: { account: '363234579155', region: 'us-east-1' },
  terminationProtection: true,
  hostedZoneId: requireContext('hostedZoneId'),
  zoneName: requireContext('zoneName'),
  recordName: requireContext('recordName'),
  spot: requireContext('spot') === 'true',
});

cdk.Tags.of(app).add('project', 'minecraft');