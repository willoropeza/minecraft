import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';

export interface MinecraftWorldStorageProps {
    readonly vpc: ec2.IVpc;
    readonly posixId?: number;
    readonly automaticBackups?: boolean;
    readonly removalPolicy?: cdk.RemovalPolicy;
}

export class MinecraftWorldStorage extends Construct {
    private static readonly volumeName = 'world';

    public readonly fileSystem: efs.IFileSystem;
    public readonly accessPoint: efs.IAccessPoint;
    public readonly posixUser: string;

    constructor(scope: Construct, id: string, props: MinecraftWorldStorageProps) {
        super(scope, id);

        const posixId = String(props.posixId ?? 1000);
        this.posixUser = `${posixId}:${posixId}`;

        const fileSystem = new efs.FileSystem(this, 'FileSystem', {
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            encrypted: true,
            performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
            throughputMode: efs.ThroughputMode.ELASTIC,
            enableAutomaticBackups: props.automaticBackups ?? true,
            removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.RETAIN,
        });

        this.accessPoint = fileSystem.addAccessPoint('AccessPoint', {
            path: '/minecraft',
            createAcl: { ownerUid: posixId, ownerGid: posixId, permissions: '750' },
            posixUser: { uid: posixId, gid: posixId },
        });

        this.fileSystem = fileSystem;
    }

    public mountInto(container: ecs.ContainerDefinition, containerPath: string): void {
        const taskDefinition = container.taskDefinition;

        taskDefinition.addVolume({
            name: MinecraftWorldStorage.volumeName,
            efsVolumeConfiguration: {
                fileSystemId: this.fileSystem.fileSystemId,
                transitEncryption: 'ENABLED',
                authorizationConfig: { accessPointId: this.accessPoint.accessPointId, iam: 'ENABLED' },
            },
        });

        container.addMountPoints({
            sourceVolume: MinecraftWorldStorage.volumeName,
            containerPath,
            readOnly: false,
        });

        this.fileSystem.grantReadWrite(taskDefinition.taskRole);
    }

    public allowConnectionsFrom(other: ec2.IConnectable): void {
        this.fileSystem.connections.allowDefaultPortFrom(other, 'NFS from the Minecraft server');
    }
}