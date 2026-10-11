import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { MinecraftNetwork } from './constructs/minecraft-network';

export class MinecraftServerStack extends cdk.Stack {
  get availabilityZones(): string[] {
    return ['us-east-1a', 'us-east-1b'];
  }

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    cdk.Validations.of(this).acknowledge({
      id: 'CloudFormation-Validate::W3010',
      reason: 'AZs are pinned on purpose so synth works offline',
    });

    const network = new MinecraftNetwork(this, 'Network');

    new cdk.CfnOutput(this, 'VpcId', { value: network.vpc.vpcId });
  }
}