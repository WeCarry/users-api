import { Context, SNSEvent, APIGatewayProxyResult } from 'aws-lambda';
import { toError } from '@carry/lambda/errors/error';
import { webhook } from './webhook';

export async function handler(event: SNSEvent, context: Context): Promise<APIGatewayProxyResult> {
	context.callbackWaitsForEmptyEventLoop = false;

	try {
		if (event.Records) {
			for (const record of event.Records) {
				await webhook(JSON.parse(record.Sns.Message));
			}
		} else {
			await webhook(event as any);
		}

		return {
			statusCode: 200,
			body: '',
		};
	} catch (err) {
		throw toError(err);
	}
}
