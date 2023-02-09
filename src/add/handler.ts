import { Context, SNSEvent } from 'aws-lambda';
import { addProfessional, bulkAddProfessional } from './add';
import { toJson, UnflattenFieldError } from '@carry/core/utilities/object';
import { toHttpError } from '../helper';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { User, validatePassword } from '@carry/praos/user/user';
import { verify } from 'jsonwebtoken';
import { Professional } from '@carry/praos/professional/professional';
import { isHospitalUser, UserType } from '@carry/praos/user/user-type';
import { UnauthorizedError } from '@carry/core/errors';
import { OrganizationUser } from '@carry/praos/organization-user/organization-user';
import { ThirdPartySystems } from '@carry/praos/thirdPartySystems/thirdPartySystems';

const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URI = process.env.DATABASE_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const DATABASE_POOL_SIZE = parseInt(process.env.DATABASE_POOL_SIZE);
const AUTHORIZATION_TOKEN = process.env.AUTHORIZATION_TOKEN;
const PROFESSIONAL_WEBHOOK_TOPIC_ARN = process.env.PROFESSIONAL_WEBHOOK_TOPIC_ARN;
const UPDATE_ENTITY_ID_TOPIC_ARN = process.env.UPDATE_ENTITY_ID_TOPIC_ARN;

type AddRequest = {
	_jwt?: string;
	ipAddress?: string;
	signupChannel?: string;
	item?: Professional;
	select?: any;
	password?: string;
	organizationId?: string;
	departmentId?: string;
	thirdPartyId?: string;
	recruiter?: string | OrganizationUser;
	jobId?: string;
	notes?: string;
	isIrp?: boolean;
	thirdPartySystems?: ThirdPartySystems[];
};

export async function handler(request: AddRequest, context: Context): Promise<User> {
	context.callbackWaitsForEmptyEventLoop = false;

	try {
		let session: JwtSession;

		if (request._jwt) {
			session = verify(request._jwt, JWT_SECRET) as JwtSession;
		}

		if (session?.userType === UserType.Nurse) {
			throw new UnauthorizedError();
		}

		if (request.password) {
			validatePassword(request.password);
		}

		console.log('session', session);
		console.log('ipAddress', request.ipAddress);

		request.item.email = request.item.email.toLowerCase();

		const user = await addProfessional({
			authToken: AUTHORIZATION_TOKEN,
			db: {
				uri: DATABASE_URI,
				dbName: DATABASE_NAME,
				poolSize: DATABASE_POOL_SIZE,
			},
			webhookTopicArn: PROFESSIONAL_WEBHOOK_TOPIC_ARN,
			session,
			ipAddress: request.ipAddress,
			item: request.item,
			select: request.select,
			organizationId: request.organizationId,
			departmentId: request.departmentId,
			thirdPartyId: request.thirdPartyId,
			recruiter: request.recruiter,
			signupChannel: request.signupChannel,
			password: request.password,
			notes: request.notes,
			external: false,
			isIrp: request.isIrp,
			thirdPartySystems: request.thirdPartySystems,
		});

		return toJson(user);
	} catch (err) {
		err = toHttpError(err);

		throw err;
	}
}

type BulkRequest = {
	isOffline?: boolean;
	_session?: JwtSession;
	data?: string;
};
