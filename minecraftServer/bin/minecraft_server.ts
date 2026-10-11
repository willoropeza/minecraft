#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MinecraftServerStack } from '../lib/minecraft_server-stack';

const app = new cdk.App();

new MinecraftServerStack(app, 'MinecraftServerStack', {
  env: { account: '363234579155', region: 'us-east-1' },
  terminationProtection: true,
});

cdk.Tags.of(app).add('project', 'minecraft');