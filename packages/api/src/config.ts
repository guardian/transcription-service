import { findParameter, getParameters } from "./configHelpers";
import { Parameter, SSM } from '@aws-sdk/client-ssm';

interface TranscriptionConfig {
    test: string // TODO: This is just the foundation of getting params from SSM
}

const region = process.env['AWS_REGION'];

const ssm = new SSM({
	region,
});

export const getConfig = async (): Promise<TranscriptionConfig> => {
	const stage = process.env['STAGE'] || 'DEV';
	const paramPath = `/${stage}/investigations/transcription-service/`;

	const parameters = await getParameters(paramPath, ssm);
    const parameterNames = parameters.map((param: Parameter) => {
        return param.Name;
      });

    console.log(`Parameters fetched: ${parameterNames.join(", ")}`);
    const testParam = findParameter(parameters, paramPath, "test");

    return {
        test: testParam
    }
};