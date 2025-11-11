import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { getCloudwatchClient, putMetricData } from './cloudwatch';
import { StandardUnit } from '@aws-sdk/client-cloudwatch';

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
export const secondsForWhisperXStartupMetric = (value: number): Metric => ({
	name: `SecondsForWhisperXStartup`,
	value,
	unit: 'Seconds',
});
export const attemptNumberMetric = (value: number): Metric => ({
	name: `AttemptNumber`,
	value,
});

export class MetricsService {
	private readonly cloudwatchClient: CloudWatchClient;
	private readonly stage: string;
	private readonly app: string;

	constructor(stage: string, region: string, app: string) {
		this.cloudwatchClient = getCloudwatchClient(region);
		this.stage = stage;
		this.app = app;
	}

	async putMetric(metric: Metric) {
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
