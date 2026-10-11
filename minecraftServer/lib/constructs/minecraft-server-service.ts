import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { MinecraftWorldStorage } from './minecraft-world-storage';

export interface MinecraftServerServiceProps {
    readonly cluster: ecs.ICluster;
    readonly repository: ecr.IRepository;
    readonly storage: MinecraftWorldStorage;
    readonly imageTag?: string;
    readonly cpu?: number;
    readonly memoryLimitMiB?: number;
    readonly spot?: boolean;
    readonly gamePort?: number;
    readonly logRetention?: logs.RetentionDays;
}

export class MinecraftServerService extends Construct implements ec2.IConnectable {
    public readonly service: ecs.FargateService;
    public readonly connections: ec2.Connections;

    constructor(scope: Construct, id: string, props: MinecraftServerServiceProps) {
        super(scope, id);

        const gamePort = props.gamePort ?? 25565;
        const memoryLimitMiB = props.memoryLimitMiB ?? 8192;

        const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
            vpc: props.cluster.vpc,
            description: 'Minecraft server - public game port',
            allowAllOutbound: true,
        });
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(gamePort), 'Minecraft Java from anywhere');

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
            cpu: props.cpu ?? 2048,
            memoryLimitMiB,
            runtimePlatform: {
                cpuArchitecture: ecs.CpuArchitecture.ARM64,
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            },
        });

        const logGroup = new logs.LogGroup(this, 'LogGroup', {
            retention: props.logRetention ?? logs.RetentionDays.TWO_WEEKS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const javaHeapGib = Math.floor((memoryLimitMiB * 0.75) / 1024);

        const serverContainer = taskDefinition.addContainer('server', {
            image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag ?? 'live'),
            versionConsistency: ecs.VersionConsistency.DISABLED,
            user: props.storage.posixUser,
            environment: {
                MEMORY: `${javaHeapGib}G`,
            },
            portMappings: [{ containerPort: gamePort, protocol: ecs.Protocol.TCP }],
            stopTimeout: cdk.Duration.seconds(120),
            linuxParameters: new ecs.LinuxParameters(this, 'LinuxParameters', { initProcessEnabled: true }),
            healthCheck: {
                command: ['CMD-SHELL', 'mc-health'],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                retries: 3,
                startPeriod: cdk.Duration.seconds(300),
            },
            logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'minecraft' }),
        });

        props.storage.mountInto(serverContainer, '/data');

        const capacityProvider = props.spot ? 'FARGATE_SPOT' : 'FARGATE';

        this.service = new ecs.FargateService(this, 'Service', {
            cluster: props.cluster,
            taskDefinition,
            desiredCount: 0,
            minHealthyPercent: 0,
            maxHealthyPercent: 100,
            assignPublicIp: true,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [securityGroup],
            enableExecuteCommand: true,
            capacityProviderStrategies: [{ capacityProvider, weight: 1 }],
            circuitBreaker: { enable: true },
        });

        this.service.node.addDependency(props.cluster);

        this.connections = this.service.connections;
        props.storage.allowConnectionsFrom(this.service);
    }
}