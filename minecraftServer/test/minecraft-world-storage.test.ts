import * as cdk from 'aws-cdk-lib/core';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MinecraftNetwork } from '../lib/constructs/minecraft-network';
import { MinecraftWorldStorage } from '../lib/constructs/minecraft-world-storage';
import { ThroughputMode } from 'aws-cdk-lib/aws-efs';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';

describe('MinecraftWorldStorage', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');
    const network = new MinecraftNetwork(stack, 'Network');
    const worldStorage = new MinecraftWorldStorage(stack, 'WorldStorage', { vpc: network.vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(stack, 'TaskDefinition');
    const container = taskDefinition.addContainer('server', {
        image: ecs.ContainerImage.fromRegistry('example/image'),
    });
    worldStorage.mountInto(container, '/data');

    const template = Template.fromStack(stack);

    test('creates an encrypted, retained file system with backups', () => {
        template.hasResource('AWS::EFS::FileSystem', {
            DeletionPolicy: 'Retain',
            Properties: Match.objectLike({
                Encrypted: true,
                ThroughputMode: 'elastic',
                BackupPolicy: { Status: 'ENABLED' },
            }),
        });
    });

    test('access point forces uid/gid 1000 under /minecraft', () => {
        template.hasResourceProperties('AWS::EFS::AccessPoint', {
            PosixUser: { Uid: '1000', Gid: '1000' },
            RootDirectory: {
                Path: '/minecraft',
                CreationInfo: { OwnerUid: '1000', OwnerGid: '1000', Permissions: '750' },
            },
        });
    });

    test('mounts the volume with TLS and IAM auth', () => {
        template.hasResourceProperties('AWS::ECS::TaskDefinition', {
            Volumes: [Match.objectLike({
                Name: 'world',
                EFSVolumeConfiguration: Match.objectLike({
                    TransitEncryption: 'ENABLED',
                    AuthorizationConfig: Match.objectLike({ IAM: 'ENABLED' }),
                }),
            })],
            ContainerDefinitions: [Match.objectLike({
                MountPoints: [{ SourceVolume: 'world', ContainerPath: '/data', ReadOnly: false }],
            })],
        });
    });

    test('grants the task role mount and write access', () => {
        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: {
                Statement: Match.arrayWith([Match.objectLike({
                    Action: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'],
                })]),
            },
        });
    });
});