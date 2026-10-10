import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { MinecraftImageRepository, MinecraftImageRepositoryProps } from '../lib/constructs/minecraft-image-repository';
import { MinecraftEcrStack } from '../lib/minecraft_ecr-stack';

describe('MinecraftImageRepository', () => {
    const buildTemplate = (repositoryProps: MinecraftImageRepositoryProps = {}): Template => {
        const app = new cdk.App();
        const stack = new cdk.Stack(app, 'TestStack');
        new MinecraftImageRepository(stack, 'ImageRepository', repositoryProps);
        return Template.fromStack(stack);
    };

    test('makes every tag immutable except live', () => {
        buildTemplate().hasResourceProperties('AWS::ECR::Repository', {
            RepositoryName: 'minecraft-server',
            ImageTagMutability: 'IMMUTABLE_WITH_EXCLUSION',
            ImageTagMutabilityExclusionFilters: [
                { ImageTagMutabilityExclusionFilterType: 'WILDCARD', ImageTagMutabilityExclusionFilterValue: 'live' },
            ],
        });
    });

    test('retains the repository by default', () => {
        buildTemplate().hasResource('AWS::ECR::Repository', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
        });
    });

    test('has an untagged-expiry rule and a keep-10 rule', () => {
        const repositories = buildTemplate().findResources('AWS::ECR::Repository');
        const repository = Object.values(repositories)[0];
        const lifecyclePolicy = JSON.parse(repository.Properties.LifecyclePolicy.LifecyclePolicyText);

        expect(lifecyclePolicy.rules).toHaveLength(2);
        expect(lifecyclePolicy.rules[0].selection).toMatchObject({ tagStatus: 'untagged', countNumber: 1 });
        expect(lifecyclePolicy.rules[1].selection).toMatchObject({ tagStatus: 'any', countNumber: 10 });
    });

    test('respect a custom image count', () => {
        const repositories = buildTemplate({ maxImageCount: 5 }).findResources('AWS::ECR::Repository');
        const repository = Object.values(repositories)[0];
        const lifecyclePolicy = JSON.parse(repository.Properties.LifecyclePolicy.LifecyclePolicyText);

        expect(lifecyclePolicy.rules[1].selection).toMatchObject({ tagStatus: 'any', countNumber: 5 });
    });

    test('DESTROY also empties the repository on delete', () => {
        buildTemplate({ removalPolicy: cdk.RemovalPolicy.DESTROY }).hasResourceProperties('AWS::ECR::Repository', {
            EmptyOnDelete: true,
        });
    });
});

describe('MinecraftEcrStack', () => {
    const app = new cdk.App();
    const stack = new MinecraftEcrStack(app, 'TestEcrStack', {
        minecraftVersion: '26.3',
        itzgImageTag: '2026.9.2-java25',
        imageRevision: '7',
    });
    const template = Template.fromStack(stack);

    test('publishes the version tag and the live tag', () => {
        const deployments = template.findResources('Custom::CDKECRDeployment');
        const destinationImages = Object.values(deployments).map((deployment) => JSON.stringify(deployment.Properties.DestImage));

        expect(destinationImages).toHaveLength(2);
        expect(destinationImages.some((destinationImage) => destinationImage.includes(':26.3-r7'))).toBe(true);
        expect(destinationImages.some((destinationImage) => destinationImage.includes(':live'))).toBe(true);
    });

    test('copies the arm64 image', () => {
        template.allResourcesProperties('Custom::CDKECRDeployment', { ImageArch: 'arm64' });
    });

    test('writes the repository name to SSM', () => {
        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: '/minecraft/ecr/repository-name',
            Type: 'String',
        });
    });
});