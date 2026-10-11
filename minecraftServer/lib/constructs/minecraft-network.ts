import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

export interface MinecraftNetworkProps {
    readonly cidr?: string;
    readonly maxAzs?: number;
    readonly containerInsights?: boolean;
}

export class MinecraftNetwork extends Construct {
    public readonly vpc: ec2.IVpc;
    public readonly cluster: ecs.ICluster;

    constructor(scope: Construct, id: string, props: MinecraftNetworkProps = {}) {
        super(scope, id);

        const vpc = new ec2.Vpc(this, 'Vpc', {
            ipAddresses: ec2.IpAddresses.cidr(props.cidr ?? '10.42.0.0/16'),
            maxAzs: props.maxAzs ?? 2,
            natGateways: 0,
            subnetConfiguration: [{ name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
            restrictDefaultSecurityGroup: true,
        });

        const containerInsightsEnabled = props.containerInsights ?? true;
        const cluster = new ecs.Cluster(this, 'Cluster', {
            clusterName: 'minecraft',
            vpc,
            enableFargateCapacityProviders: true,
            containerInsightsV2: containerInsightsEnabled
                ? ecs.ContainerInsights.ENABLED
                : ecs.ContainerInsights.DISABLED,
        });

        this.vpc = vpc;
        this.cluster = cluster;
    }
}