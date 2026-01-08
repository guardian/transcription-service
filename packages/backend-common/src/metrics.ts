import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { getCloudwatchClient, putMetricData } from './cloudwatch';
import { StandardUnit } from '@aws-sdk/client-cloudwatch';
import { Dimension } from '@aws-sdk/client-cloudwatch/dist-types/models/models_0';
import { AwsConfig } from './types';

type Metric = {
	name: string;
	value: number;
	unit?: StandardUnit;
};
export const FailureMetric: Metric = {
	name: 'Failure',
	value: 1,
	unit: 'Count',
};
export const secondsFromEnqueueToStartMetric = (value: number): Metric => ({
	name: `SecondsFromEnqueueToStart`,
	value,
	unit: 'Seconds',
});
export const secondsFromEnqueueToCompleteEmailSentMetric = (
	value: number,
): Metric => ({
	name: `SecondsFromEnqueueToCompleteEmailSent`,
	value,
	unit: 'Seconds',
});
export const secondsForWhisperXStartupMetric = (value: number): Metric => ({
	name: `SecondsForWhisperXStartup`,
	value,
	unit: 'Seconds',
});
export const attemptNumberMetric = (value: number): Metric => ({
	name: `AttemptNumber`,
	value,
});
export const transcriptionRateMetric = (value: number): Metric => ({
	name: `TranscriptionRate`,
	value,
});

export const mediaDownloadJobMetric: Metric = {
	name: `MediaDownloadJob`,
	value: 1,
	unit: 'Count',
};

export class MetricsService {
	private readonly cloudwatchClient: CloudWatchClient;
	private readonly stage: string;
	private readonly app: string;

	constructor(stage: string, awsConfig: AwsConfig, app: string) {
		this.cloudwatchClient = getCloudwatchClient(awsConfig);
		this.stage = stage;
		this.app = app;
	}

	async putMetric(metric: Metric, extraDimensions: Dimension[] = []) {
		await putMetricData(this.cloudwatchClient, {
			Namespace: `TranscriptionService`,
			MetricData: [
				{
					Dimensions: [
						{
							Name: 'Stage',
							Value: this.stage,
						},
						{
							Name: 'App',
							Value: this.app,
						},
						...extraDimensions,
					],
					MetricName: metric.name,
					Value: metric.value,
					Unit: metric.unit,
					Timestamp: new Date(),
				},
			],
		});
	}
}
