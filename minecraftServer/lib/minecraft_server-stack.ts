import * as cdk from 'aws-cdk-lib/core';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { MinecraftNetwork } from './constructs/minecraft-network';
import { MinecraftServerService } from './constructs/minecraft-server-service';
import { MinecraftWorldStorage } from './constructs/minecraft-world-storage';
import { TaskPublicDnsUpdater } from './constructs/task-public-dns-updater';

export interface MinecraftServerStackProps extends cdk.StackProps {
  readonly hostedZoneId: string;
  readonly zoneName: string;
  readonly recordName: string;
  readonly spot: boolean;
}
export class MinecraftServerStack extends cdk.Stack {
  get availabilityZones(): string[] {
    return ['us-east-1a', 'us-east-1b'];
  }

  constructor(scope: Construct, id: string, props: MinecraftServerStackProps) {
    super(scope, id, props);
    cdk.Validations.of(this).acknowledge({
      id: 'CloudFormation-Validate::W3010',
      reason: 'AZs are pinned on purpose so synth works offline',
    });

    const network = new MinecraftNetwork(this, 'Network');

    const repositoryName = ssm.StringParameter.valueForStringParameter(this, '/minecraft/ecr/repository-name');
    const repository = ecr.Repository.fromRepositoryName(this, 'Repository', repositoryName);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    const worldStorage = new MinecraftWorldStorage(this, 'WorldStorage', { vpc: network.vpc });

    const server = new MinecraftServerService(this, 'Server', {
      cluster: network.cluster,
      repository,
      storage: worldStorage,
      spot: props.spot,
    });

    new TaskPublicDnsUpdater(this, 'DnsUpdater', {
      service: server.service,
      hostedZone,
      recordName: props.recordName,
    });

    new ssm.StringParameter(this, 'ClusterNameParam', {
      parameterName: '/minecraft/server/cluster-name',
      stringValue: network.cluster.clusterName,
    });
    new ssm.StringParameter(this, 'ServiceNameParam', {
      parameterName: '/minecraft/server/service-name',
      stringValue: server.service.serviceName,
    });

    const buildUpdateServiceCommand = (commandArguments: string): string => cdk.Fn.join('', [
      'aws ecs update-service --cluster ', network.cluster.clusterName,
      ' --service ', server.service.serviceName,
      ` ${commandArguments}`,
    ]);

    new cdk.CfnOutput(this, 'StartCommand', { value: buildUpdateServiceCommand('--desired-count 1') });
    new cdk.CfnOutput(this, 'StopCommand', { value: buildUpdateServiceCommand('--desired-count 0') });
    new cdk.CfnOutput(this, 'RestartCommand', { value: buildUpdateServiceCommand('--force-new-deployment') });
    new cdk.CfnOutput(this, 'ServerAddress', { value: props.recordName });
    new cdk.CfnOutput(this, 'VpcId', { value: network.vpc.vpcId });
    new cdk.CfnOutput(this, 'FileSystemId', { value: worldStorage.fileSystem.fileSystemId });
  }
}