import * as cdk from 'aws-cdk-lib/core';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export interface MinecraftImageRepositoryProps {
    readonly repositoryName?: string;
    readonly liveTag?: string;
    readonly maxImageCount?: number;
    readonly removalPolicy?: cdk.RemovalPolicy;
}

export class MinecraftImageRepository extends Construct {
    public readonly repository: ecr.IRepository;
    constructor(scope: Construct, id: string, props: MinecraftImageRepositoryProps = {}) {
        super(scope, id);
        const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.RETAIN;
        const maxImageCount = props.maxImageCount ?? 10;
        const liveTag = props.liveTag ?? 'live';

        const repository = new ecr.Repository(this, 'Repository', {
            repositoryName: props.repositoryName ?? 'minecraft-server',
            imageScanOnPush: true,
            imageTagMutability: ecr.TagMutability.IMMUTABLE_WITH_EXCLUSION,
            imageTagMutabilityExclusionFilters: [ecr.ImageTagMutabilityExclusionFilter.wildcard(liveTag)],
            encryption: ecr.RepositoryEncryption.AES_256,
            removalPolicy,
            emptyOnDelete: removalPolicy === cdk.RemovalPolicy.DESTROY,
        });

        repository.addLifecycleRule({
            description: 'Expire untagged images after 1 day',
            tagStatus: ecr.TagStatus.UNTAGGED,
            maxImageAge: cdk.Duration.days(1),
        });

        repository.addLifecycleRule({
            description: `Keep the ${maxImageCount} most recent images`,
            tagStatus: ecr.TagStatus.ANY,
            maxImageCount,
        });

        this.repository = repository;
    }
}