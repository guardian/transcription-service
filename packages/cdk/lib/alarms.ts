import type { GuStack } from '@guardian/cdk/lib/constructs/core';
import { Duration } from 'aws-cdk-lib';
import type { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import {
	Alarm,
	ComparisonOperator,
	Metric,
	TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import type { Queue } from 'aws-cdk-lib/aws-sqs';

export const makeAlarms = (
	scope: GuStack,
	taskQueue: Queue,
	gpuTaskQueue: Queue,
	dlQueue: Queue,
	cpuWorkerAsg: AutoScalingGroup,
	gpuWorkerAsg: AutoScalingGroup,
	alarmTopicArn: string,
) => {
	const oldestMessageAlarmThresholdMinutes = 60;
	const oldestMessageAlarmThresholdSeconds =
		oldestMessageAlarmThresholdMinutes * 60;
	const alarms = [
		// alarm when a message is added to the dead letter queue
		// note that queue metrics go to 'sleep' if it is empty for more than 6 hours, so it may take up to 16 minutes
		// for this alarm to trigger - see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-monitoring-using-cloudwatch.html
		new Alarm(scope, 'DeadLetterQueueAlarm', {
			alarmName: `transcription-service-dead-letter-queue-${scope.stage}`,
			metric: dlQueue.metricApproximateNumberOfMessagesVisible({
				period: Duration.minutes(1),
				statistic: 'max',
			}),
			threshold: 1,
			evaluationPeriods: 1,
			actionsEnabled: true,
			alarmDescription: `A transcription job has been sent to the dead letter queue. This may be because ffmpeg can't convert the file (maybe it's a JPEG) or because the transcription job has failed multiple times.`,
			treatMissingData: TreatMissingData.IGNORE,
			comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		}),
		// alarm when there's a really old message in the task queue
		new Alarm(scope, 'TaskQueueOldMessageAlarm', {
			alarmName: `transcription-service-task-queue-${scope.stage}`,
			metric: taskQueue.metricApproximateAgeOfOldestMessage({
				period: Duration.minutes(5),
				statistic: 'max',
			}),
			threshold: oldestMessageAlarmThresholdSeconds,
			evaluationPeriods: 1,
			actionsEnabled: true,
			alarmDescription: `A transcription job has been in the task queue for more than ${oldestMessageAlarmThresholdMinutes} minutes`,
			treatMissingData: TreatMissingData.IGNORE,
			comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		}),
		new Alarm(scope, 'GpuTaskQueueOldMessageAlarm', {
			alarmName: `transcription-service-gpu-task-queue-${scope.stage}`,
			metric: gpuTaskQueue.metricApproximateAgeOfOldestMessage({
				period: Duration.minutes(5),
				statistic: 'max',
			}),
			threshold: oldestMessageAlarmThresholdSeconds,
			evaluationPeriods: 1,
			actionsEnabled: true,
			alarmDescription: `A transcription job has been in the gpu task queue for more than ${oldestMessageAlarmThresholdMinutes} minutes`,
			treatMissingData: TreatMissingData.IGNORE,
			comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		}),
		// alarm when failure metric is greater than 0
		new Alarm(scope, 'FailureAlarm', {
			alarmName: `transcription-service-failure-${scope.stage}`,
			//  reference the custom metric created in metrics.ts library
			metric: new Metric({
				namespace: 'TranscriptionService',
				metricName: 'Failure',
				dimensionsMap: {
					Stage: scope.stage,
				},
				statistic: 'sum',
				period: Duration.minutes(1),
			}),
			threshold: 1,
			comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			evaluationPeriods: 1,
			actionsEnabled: true,
			alarmDescription: 'A transcription service failure has occurred',
			treatMissingData: TreatMissingData.IGNORE,
		}),
		// alarm when at least one instance has been running in the worker asg during every 5 minute period for
		// more than 12 hours
		new Alarm(scope, 'WorkerInstanceAlarm', {
			alarmName: `transcription-service-worker-instances-${scope.stage}`,
			// this doesn't actually create the metric - just a reference to it
			metric: new Metric({
				namespace: 'AWS/AutoScaling',
				metricName: 'GroupTotalInstances',
				dimensionsMap: {
					AutoScalingGroupName: gpuWorkerAsg.autoScalingGroupName,
				},
				statistic: 'min',
				period: Duration.minutes(5),
			}),
			threshold: 1,
			comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			evaluationPeriods: 12 * 12, // 12 hours as metric has period of 5 minutes
			actionsEnabled: true,
			alarmDescription: `There has been at least 1 worker instance running for 12 hours.
						This could mean that a worker is failing to be scaled in, which could have significant cost implications.
						Please check that all running workers are doing something useful.`,
			treatMissingData: TreatMissingData.IGNORE,
		}),
	];
	const snsAction = new SnsAction(
		Topic.fromTopicArn(scope, 'TranscriptionAlarmTopic', alarmTopicArn),
	);
	alarms.forEach((alarm) => {
		alarm.addAlarmAction(snsAction);
	});
};
