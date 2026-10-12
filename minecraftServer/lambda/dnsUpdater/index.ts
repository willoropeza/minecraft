import { DescribeNetworkInterfacesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { ChangeResourceRecordSetsCommand, Route53Client } from '@aws-sdk/client-route-53';
import type { EventBridgeEvent } from 'aws-lambda';

interface TaskAttachmentDetail {
    name: string;
    value: string;
}

interface TaskAttachment {
    type: string;
    details: TaskAttachmentDetail[];
}

export interface TaskStateChangeDetail {
    taskArn: string;
    attachments?: TaskAttachment[];
}

export type TaskStateChangeEvent = EventBridgeEvent<'ECS Task State Change', TaskStateChangeDetail>;

const ec2Client = new EC2Client({});
const route53Client = new Route53Client({});

const readRequiredEnv = (variableName: string): string => {
    const variableValue = process.env[variableName];
    if (!variableValue) throw new Error(`Missing environment variable ${variableName}`);
    return variableValue;
};

export const handler = async (event: TaskStateChangeEvent): Promise<string> => {
    const hostedZoneId = readRequiredEnv('HOSTED_ZONE_ID');
    const recordName = readRequiredEnv('RECORD_NAME');
    const recordTtlSeconds = Number(process.env.RECORD_TTL ?? '30');

    const networkInterfaceAttachment = event.detail.attachments?.find((attachment) => attachment.type === 'eni');
    const networkInterfaceId = networkInterfaceAttachment?.details.find(
        (attachmentDetail) => attachmentDetail.name === 'networkInterfaceId',
    )?.value;
    if (!networkInterfaceId) throw new Error(`No ENI attached to task ${event.detail.taskArn}`);

    const describeResult = await ec2Client.send(
        new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [networkInterfaceId] }),
    );
    const publicIp = describeResult.NetworkInterfaces?.[0]?.Association?.PublicIp;
    if (!publicIp) throw new Error(`ENI ${networkInterfaceId} has no public IP`);

    await route53Client.send(new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
            Comment: `Minecraft task ${event.detail.taskArn}`,
            Changes: [{
                Action: 'UPSERT',
                ResourceRecordSet: {
                    Name: recordName,
                    Type: 'A',
                    TTL: recordTtlSeconds,
                    ResourceRecords: [{ Value: publicIp }],
                },
            }],
        },
    }));

    console.log(`Pointed ${recordName} at ${publicIp}`);
    return publicIp;
};