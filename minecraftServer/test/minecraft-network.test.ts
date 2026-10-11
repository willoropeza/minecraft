import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { MinecraftNetwork } from '../lib/constructs/minecraft-network';

describe('MinecraftNetwork', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    new MinecraftNetwork(stack, 'Network');
    const template = Template.fromStack(stack);

    test('creates a VPC with the expected CIDR', () => {
        template.hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.42.0.0/16' });
    });

    test('has two public subnets and no NAT gateway', () => {
        template.resourceCountIs('AWS::EC2::Subnet', 2);
        template.resourceCountIs('AWS::EC2::NatGateway', 0);
        template.allResourcesProperties('AWS::EC2::Subnet', { MapPublicIpOnLaunch: true });
    });

    test('enables Fargate and Fargate Spot on the cluster', () => {
        template.hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
            CapacityProviders: ['FARGATE', 'FARGATE_SPOT'],
        });
    });

    test('turns on Container Insights', () => {
        template.hasResourceProperties('AWS::ECS::Cluster', {
            ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
        });
    });
});