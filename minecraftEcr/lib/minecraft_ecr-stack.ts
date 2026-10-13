import * as path from 'path'
import * as cdk from 'aws-cdk-lib/core'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'
import { MinecraftImagePublisher } from './constructs/minecraft-image-publisher'
import { MinecraftImageRepository } from './constructs/minecraft-image-repository'

export interface MinecraftEcrStackProps extends cdk.StackProps {
  readonly minecraftVersion: string
  readonly itzgImageTag: string
  readonly imageRevision: string
}

export class MinecraftEcrStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MinecraftEcrStackProps) {
    super(scope, id, props)

    const imageRepository = new MinecraftImageRepository(this, 'ImageRepository')

    new MinecraftImagePublisher(this, 'ImagePublisher', {
      repository: imageRepository.repository,
      dockerDirectory: path.join(__dirname, '..', 'docker'),
      versionTag: `${props.minecraftVersion}-r${props.imageRevision}`,
      buildArgs: {
        ITZG_IMAGE_TAG: props.itzgImageTag,
        MINECRAFT_VERSION: props.minecraftVersion,
      },
    })

    new ssm.StringParameter(this, 'RepositoryNameParam', {
      parameterName: '/minecraft/ecr/repository-name',
      stringValue: imageRepository.repository.repositoryName,
    })

    new cdk.CfnOutput(this, 'RepositoryUri', { value: imageRepository.repository.repositoryUri })
  }
}
