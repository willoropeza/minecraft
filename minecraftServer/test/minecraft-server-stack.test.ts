import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { MinecraftServerStack } from '../lib/minecraft_server-stack';

describe('MinecraftServerStack', () => {
    const app = new cdk.App();
    const stack = new MinecraftServerStack(app, 'TestServerStack', {
        env: { account: '363234579155', region: 'us-east-1' },
    });
    const template = Template.fromStack(stack);

    test('uses the two named Availability Zones', () => {
        template.hasResourceProperties('AWS::EC2::Subnet', { AvailabilityZone: 'us-east-1a' });
        template.hasResourceProperties('AWS::EC2::Subnet', { AvailabilityZone: 'us-east-1b' });
    });

    test('outputs the VPC id', () => {
        template.hasOutput('VpcId', {});
    });

    test('has exactly one retained file system', () => {
        template.resourceCountIs('AWS::EFS::FileSystem', 1);
        template.hasResource('AWS::EFS::FileSystem', { DeletionPolicy: 'Retain' });
    });
});