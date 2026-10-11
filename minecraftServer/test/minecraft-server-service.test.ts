import * as cdk from 'aws-cdk-lib/core';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MinecraftNetwork } from '../lib/constructs/minecraft-network';
import { MinecraftServerService, MinecraftServerServiceProps } from '../lib/constructs/minecraft-server-service';
import { MinecraftWorldStorage } from '../lib/constructs/minecraft-world-storage';
import { IpProtocol } from 'aws-cdk-lib/aws-ec2';
import { ContainerDefinition, CpuArchitecture, OperatingSystemFamily, VersionConsistency } from 'aws-cdk-lib/aws-ecs';
import { NetworkConfiguration } from 'aws-cdk-lib/aws-bedrockagentcore';
import { CapacityProvider } from 'aws-cdk-lib/aws-lambda';
import { Environment } from 'aws-cdk-lib/aws-appconfig';

type OptionalServiceProps = Partial<Pick<MinecraftServerServiceProps, 'spot' | 'memoryLimitMiB'>>;

const buildTemplate = (optionalProps: OptionalServiceProps = {}): Template => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    const network = new MinecraftNetwork(stack, 'Network');
    const worldStorage = new MinecraftWorldStorage(stack, 'WorldStorage', { vpc: network.vpc });
    const repository = ecr.Repository.fromRepositoryName(stack, 'Repository', 'minecraft-server');

    new MinecraftServerService(stack, 'Server', {
        cluster: network.cluster,
        repository,
        storage: worldStorage,
        ...optionalProps,
    });
    return Template.fromStack(stack);
};

describe('MinecraftServerService', () => {
    const template = buildTemplate();

    test('opens only the game port to the internet', () => {
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: 'Minecraft server - public game port',
            SecurityGroupIngress: [Match.objectLike({ CidrIp: '0.0.0.0/0', FromPort: 25565, ToPort: 25565, IpProtocol: 'tcp' })],
        });
    });

    test('runs ARM64 with 2 vCPU and 8 GB', () => {
        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            Cpu: '2048',
            Memory: '8192',
            RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
        });
    });

    test('container pulls live fresh on every start and runs as 1000:1000', () => {
        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            ContainerDefinitions: [Match.objectLike({
                User: '1000:1000',
                VersionConsistency: 'disabled',
                StopTimeout: 120,
                Environment: [{ Name: 'MEMORY', Value: '6G' }],
            })],
        });
    });

    test('service starts at 0 tasks and never runs two at once', () => {
        template.hasResourceProperties('AWS::ECS::Service', {
            DesiredCount: 0,
            DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 0, MaximumPercent: 100 }),
            EnableExecuteCommand: true,
            NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }) },
        });
    });

    test('waits for the capacity providers before creating the service', () => {
        const services = template.findResources('AWS::ECS::Service');
        const associations = template.findResources('AWS::ECS::ClusterCapacityProviderAssociations');
        const associationLogicalId = Object.keys(associations)[0];
        const service = Object.values(services)[0];
        expect(service.DependsOn).toContain(associationLogicalId);
    });

    test('lets the server reach EFS on port 2049', () => {
        template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', { FromPort: 2049, ToPort: 2049 });
    });
});

describe('MinecraftServerService with spot', () => {
    test('uses Fargate Spot', () => {
        buildTemplate({ spot: true }).hasResourceProperties('AWS::ECS::Service', {
            CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }],
        });
    });

    test('sizes the Java heap from task memory', () => {
        buildTemplate({ memoryLimitMiB: 4096 }).hasResourceProperties('AWS::ECS::TaskDefinition', {
            ContainerDefinitions: [Match.objectLike({ Environment: [{ Name: 'MEMORY', Value: '3G' }] })],
        });
    });
});
