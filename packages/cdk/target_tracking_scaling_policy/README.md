## Target tracking scaling policy for ASG

We set a target-tracking scaling policy for the worker autoscaling group so that
the number of worker instances is equal to the number of messages in the queue
following an approach documented [here](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-target-tracking-metric-math.html).

At the time of writing, AWS supports this feature only through the cli, but not
in CDK. Instead we have to resort to a bash script `put-scaling-policy.sh` and
configuration files `config-CODE.json` `config-PROD.json`.

> "You can create a target tracking scaling policy using metric math only if you
> use the AWS CLI or an SDK. This feature is not yet available in the console and
> AWS CloudFormation."

To update a scaling policy, run `put-scaling-policy.sh`, passing the stage as a
parameter e.g. `put-scaling-policy.sh CODE`.

Once target-tracking scaling policies are supported in cloudformation and CDK,
we can remove this directory and reimplement the policy in `cdk.ts`
