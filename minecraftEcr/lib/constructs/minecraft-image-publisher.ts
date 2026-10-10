import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageName, ECRDeployment } from 'cdk-ecr-deployment';
import { Construct } from 'constructs';

export interface MinecraftImagePublisherProps {
    readonly repository: ecr.IRepository;
    readonly dockerDirectory: string;
    readonly versionTag: string;
    readonly liveTag?: string;
    readonly buildArgs?: Record<string, string>;
}

export class MinecraftImagePublisher extends Construct {
    public readonly liveTag: string;
    constructor(scope: Construct, id: string, props: MinecraftImagePublisherProps) {
        super(scope, id);
        this.liveTag = props.liveTag ?? 'live';
        const imageAsset = new ecrAssets.DockerImageAsset(this, 'Image', {
            directory: props.dockerDirectory,
            platform: ecrAssets.Platform.LINUX_ARM64,
            buildArgs: props.buildArgs,
        });

        const tagsToPublish: Record<string, string> = {
            PublishVersionTag: props.versionTag,
            PublishLiveTag: this.liveTag,
        };

        for (const [deploymentId, imageTag] of Object.entries(tagsToPublish)) {
            new ECRDeployment(this, deploymentId, {
                src: new DockerImageName(imageAsset.imageUri),
                dest: new DockerImageName(`${props.repository.repositoryUri}:${imageTag}`),
                imageArch: ['arm64'],
            });
        }
    }
}