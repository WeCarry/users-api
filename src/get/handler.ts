import { Context } from 'aws-lambda';
import { getProfessional } from './get';
import { toJson } from '@carry/core/utilities/object';
import { toHttpError } from '../helper';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { User } from '@carry/praos/user/user';
import { UnauthorizedError } from '@carry/core/errors';
import { verify } from 'jsonwebtoken';
import { getProfessionalByToken } from './get-by-token';
import { ShareAccess } from '@carry/praos/professional/share';

const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URI = process.env.DATABASE_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const DATABASE_POOL_SIZE = parseInt(process.env.DATABASE_POOL_SIZE);

type GetRequest = {
	_jwt?: string;
	id?: string;
	verificationToken?: string;
	shareToken?: string;
	passwordResetToken?: string;
	select?: any | ShareAccess;
};

export async function handler(request: GetRequest, context: Context): Promise<User> {
	context.callbackWaitsForEmptyEventLoop = false;

	try {
		let session: JwtSession;

		if (request._jwt) {
			session = verify(request._jwt, JWT_SECRET) as JwtSession;
		}

		if (
			!session &&
			!request.verificationToken &&
			!request.shareToken &&
			!request.passwordResetToken
		) {
			throw new UnauthorizedError();
		}

		let user: User;

		if (session) {
			user = await getProfessional({
				db: {
					uri: DATABASE_URI,
					dbName: DATABASE_NAME,
					poolSize: DATABASE_POOL_SIZE,
				},
				session: session,
				userId: request.id === 'session' ? null : request.id,
				select: request.select,
			});
		} else {
			user = await getProfessionalByToken({
				db: {
					uri: DATABASE_URI,
					dbName: DATABASE_NAME,
					poolSize: DATABASE_POOL_SIZE,
				},
				userId: request.id,
				verificationToken: request.verificationToken,
				shareToken: request.shareToken,
				passwordResetToken: request.passwordResetToken,
			});
		}

		return toJson(user);
	} catch (err) {
		err = toHttpError(err);

		throw err;
	}
}
