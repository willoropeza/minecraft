import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { MinecraftImageRepository, MinecraftImageRepositoryProps } from '../lib/constructs/minecraft-image-repository';

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