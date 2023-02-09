import { httpPut, httpPost } from '@carry/http';

export type ExecuteOptions = {
	httpMethod: 'put' | 'post';
	url: string;
	body: string;
	headers?: object;
};

export type ProfessionalNotification = {
	id: string;
	isUpdate: boolean;
};

export async function webhook(options: ExecuteOptions): Promise<void> {
	if (options.httpMethod === 'put') {
		await httpPut({
			url: options.url,
			headers: Object.assign(
				{
					'Content-Type': 'application/json',
				},
				options.headers || {}
			),
			body: options.body,
			json: true,
			timeout: 30000,
		});

		return;
	}

	await httpPost({
		url: options.url,
		headers: Object.assign(
			{
				'Content-Type': 'application/json',
			},
			options.headers || {}
		),
		body: options.body,
		json: true,
		timeout: 30000,
	});
}
