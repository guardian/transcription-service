import {
	CloudWatchClient,
	PutMetricDataInput,
} from '@aws-sdk/client-cloudwatch';
import { getCloudwatchClient, putMetricData } from './cloudwatch';

type Metric = {
	name: string;
	unit: 'Count';
};
export const FailureMetric: Metric = {
	name: 'Failure',
	unit: 'Count',
};

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
		const metricData: PutMetricDataInput = {
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
					Value: 1,
					Timestamp: new Date(),
				},
			],
		};
		await putMetricData(this.cloudwatchClient, metricData);
	}
}
