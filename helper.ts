import { toError } from '@carry/lambda/errors/error';
import { HttpError, MidnightDateError } from '@carry/core/errors';
import {
	AccountAlreadyVerifiedError,
	SuspendedAccountError,
	InactiveAccountError,
	UserNotFoundError,
	InvalidShareTypeError,
	InvalidFilePathError,
	PasswordRequiredError,
	AccountAlreadyExistsError,
	InvalidCredentialsError,
	InvalidVerificationTokenError,
	AffiliationAlreadyExistsError,
	AffiliationNotFoundError,
	AffiliationRejectedError,
	DeactivatedAccountError,
	ShareExpiredError,
	AddAffiliationRequiredError,
	OrganizationNotFoundError,
	EmailAlreadyInUseError,
	TokenExpiredError,
} from '@carry/praos/errors';
import { NoDocumentsError } from './documents/documents';
import { httpPost, httpPut } from '@carry/http';

export type WebhookOptions = {
	httpMethod: 'put' | 'post';
	url: string;
	body: object;
};

export function toHttpError(err: any): Error {
	if (err?.constructor) {
		switch (err.constructor) {
			case DeactivatedAccountError:
			case InactiveAccountError:
			case SuspendedAccountError:
			case ShareExpiredError:
				err = new HttpError(err, 403);
				break;
			case AffiliationAlreadyExistsError:
			case AffiliationNotFoundError:
			case AffiliationRejectedError:
			case NoDocumentsError:
			case UserNotFoundError:
			case EmailAlreadyInUseError:
			case InvalidCredentialsError:
			case InvalidFilePathError:
			case InvalidShareTypeError:
			case InvalidVerificationTokenError:
			case TokenExpiredError:
			case MidnightDateError:
			case OrganizationNotFoundError:
			case PasswordRequiredError:
				err = new HttpError(err, 400);
				break;
			case AddAffiliationRequiredError:
			case AccountAlreadyExistsError:
			case AccountAlreadyVerifiedError:
				err = new HttpError(err, 409);
				break;

			default:
				break;
		}
	}

	return toError(err);
}

export async function callWebhook(options: WebhookOptions): Promise<void> {
	if (options.httpMethod === 'put') {
		await httpPut({
			url: options.url,
			headers: {
				'Content-Type': 'application/json',
			},
			body: options.body,
			json: true,
			timeout: 30000,
		});

		return;
	}

	await httpPost({
		url: options.url,
		headers: {
			'Content-Type': 'application/json',
		},
		body: options.body,
		json: true,
		timeout: 30000,
	});
}
