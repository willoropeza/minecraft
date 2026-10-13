# minecraftServer

CDK app that runs the Minecraft server. It creates the network, the world storage, the ECS
Fargate service and two Lambda functions: one points the server's DNS record at the task's
public IP when it starts, and one scales the service back to 0 after the server auto-stops.

The service is created with `desiredCount: 0`. Nothing runs (and nothing costs compute) until
you set it to 1. **Deploy `minecraftEcr` first**: this app pulls the `live` image from the
repository that `minecraftEcr` publishes.

## How it fits together

```
desiredCount 1 ──► ECS service ──► Fargate task (ARM64, Spot) ◄──► EFS (world at /data)
                                        │
                     RUNNING ───────────┤
                        ▼               │ exits with code 0 (itzg auto-stop)
               DNS updater Lambda       ▼
               UPSERT A record   Auto-stopper Lambda
               → task public IP  desiredCount 0
```

- **Network:** VPC `10.42.0.0/16` with public subnets only in `us-east-1a` and `us-east-1b`, and
  no NAT gateway. The task gets a public IP directly. The ECS cluster is named `minecraft`.
- **Server:** one Fargate task, 2 vCPU / 8 GB, ARM64, on `FARGATE_SPOT` (or `FARGATE`). The
  Java heap is 75% of task memory. Only TCP 25565 is open. ECS Exec is on, so admin access goes
  through `aws ecs execute-command` and IAM, not RCON.
- **World storage:** encrypted EFS with elastic throughput, daily AWS Backup, and removal
  policy `RETAIN`. The task mounts it through an access point at `/minecraft`, as UID/GID 1000,
  with TLS and IAM authorization.
- **DNS updater:** an EventBridge rule fires when a task of this service reaches `RUNNING`. The
  Lambda reads the task's ENI, finds its public IP and UPSERTs the A record (TTL 30 s). Its IAM
  policy only allows `UPSERT` of that one A record.
- **Auto-stopper:** itzg's `ENABLE_AUTOSTOP` (set in the `minecraftEcr` image) shuts the server
  down after 30 minutes with no players (`AUTOSTOP_TIMEOUT_EST=1800`). An EventBridge rule matches only a clean self-exit
  (`stopCode` `EssentialContainerExited` and exit code 0), so deploys, Spot reclaims, manual
  stops and crashes are ignored. The Lambda sets `desiredCount` to 0 so ECS does not restart the
  task. Its IAM policy only allows `ecs:UpdateService` on this service.

## SSM parameters

| Parameter                        | Direction | Notes                                                      |
| -------------------------------- | --------- | ---------------------------------------------------------- |
| `/minecraft/ecr/repository-name` | Read      | Written by `minecraftEcr`                                  |
| `/minecraft/dns/hosted-zone-id`  | Read      | **Create it yourself** before the first deploy (see below) |
| `/minecraft/server/cluster-name` | Written   | Used by the operating commands in the root README          |
| `/minecraft/server/service-name` | Written   | Used by the operating commands in the root README          |

Both read parameters are resolved by CloudFormation at deploy time, so synth and tests never
call AWS. Create the hosted zone parameter once per account:

```bash
aws ssm put-parameter --name /minecraft/dns/hosted-zone-id --type String --value <hosted-zone-id>
```

The stack deploys to the account of your current AWS credentials (`CDK_DEFAULT_ACCOUNT`) in
`us-east-1`.

## Layout

```
bin/minecraft_server.ts                       entry point (env, termination protection, project=minecraft tag)
lib/minecraft_server-stack.ts                 MinecraftServerStack: wires the constructs, SSM parameters and outputs
lib/constructs/minecraft-network.ts           VPC (public subnets, no NAT) and the `minecraft` ECS cluster
lib/constructs/minecraft-world-storage.ts     EFS file system, access point, mount and NFS access
lib/constructs/minecraft-server-service.ts    task definition, security group, log group and Fargate service
lib/constructs/task-public-dns-updater.ts     EventBridge rule + Lambda that updates the A record
lib/constructs/service-auto-stopper.ts        EventBridge rule + Lambda that scales the service to 0
lambda/dnsUpdater/index.ts                    DNS updater handler
lambda/autoStopper/index.ts                   auto-stopper handler
lambda/autoStopper/self-exit.ts               stop code and exit code shared by the rule and the handler
test/                                         Jest tests for the template and both handlers
```

## Configuration (`cdk.json` context)

| Key          | Example                  | Notes                                                                   |
| ------------ | ------------------------ | ----------------------------------------------------------------------- |
| `zoneName`   | `dev.thirdechelon.io`    | Your Route 53 hosted zone. Its ID comes from SSM, not from here         |
| `recordName` | `mc.dev.thirdechelon.io` | The address players connect to. Must be inside `zoneName`               |
| `spot`       | `true`                   | `true` runs on `FARGATE_SPOT` (about 70% cheaper), `false` on `FARGATE` |

## Stack outputs

| Output                                          | Value                                                |
| ----------------------------------------------- | ---------------------------------------------------- |
| `StartCommand`, `StopCommand`, `RestartCommand` | Ready-to-run `aws ecs update-service` commands       |
| `ServerAddress`                                 | The `recordName` players connect to                  |
| `VpcId`, `FileSystemId`                         | IDs for finding the network and world in the console |

## Commands

```bash
npm ci                 # install exactly what package-lock.json specifies
npm run format         # format with Prettier
npx tsc                # type-check
npm run format:check   # verify formatting (CI fails without it)
npx jest               # run tests
npx cdk synth --quiet  # write templates to cdk.out/ (no AWS credentials needed)
npx cdk diff           # compare with the deployed stack (needs AWS credentials)
```

## Notes

- **First start after a deploy can fail once** with an EFS DNS resolution error. New mount
  targets take up to about 90 seconds to appear in DNS. ECS retries the task and it starts.
- **The stack has termination protection.** The EFS file system is retained when the stack is
  deleted, so the world survives. Delete it by hand if you no longer need it.
- **Availability Zones are pinned** in the stack (`us-east-1a`, `us-east-1b`) so synth works
  offline. The `W3010` validation warning this causes is acknowledged in the stack constructor.
