import { Context } from 'aws-lambda';
import { listProfessionals, ListOrderBy, ListResponse, AdvancedSearch } from './list';
import { toJson, tryParse } from '@carry/core/utilities/object';
import { toHttpError } from '../helper';
import { isInteger } from '@carry/core/utilities/string';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { isAdminUser, isHospitalUser, UserType } from '@carry/praos/user/user-type';
import { parseBoolean } from '@carry/core/utilities/boolean';
import { UnauthorizedError } from '@carry/core/errors';

const DATABASE_URI = process.env.DATABASE_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const DATABASE_POOL_SIZE = parseInt(process.env.DATABASE_POOL_SIZE);

type ListRequest = {
	_session?: JwtSession;
	profession?: string;
	organizationId?: string;
	departmentId?: string;
	recruiterId?: string;
	isIrp?: string;
	isMarketplace?: string;
	isDeactivated?: string;
	orderBy: ListOrderBy;
	limit?: string;
	skip?: string;
	status?: 'NOT_ACTIVE' | 'ACTIVATED' | 'ISSUES' | 'ACTIVE' | 'LICENSED' | 'COMPLETED';
	statusCounts?: string;
	search?: string;
	isSuspended?: string;
	select?: string;
};

export async function handler(request: ListRequest, context: Context): Promise<ListResponse> {
	context.callbackWaitsForEmptyEventLoop = false;

	try {
		//request._session = { id: '', userId: '5f8f99e2e566b000085f3189', userType: UserType.HospitalAdmin, date: new Date() };

		if (
			!request._session ||
			(!isHospitalUser(request._session.userType) && !isAdminUser(request._session.userType))
		) {
			throw new UnauthorizedError();
		}

		const result = await listProfessionals({
			db: {
				uri: DATABASE_URI,
				dbName: DATABASE_NAME,
				poolSize: DATABASE_POOL_SIZE,
			},
			session: request._session,
			profession: request.profession,
			organizationId: request.organizationId,
			departmentId: request.departmentId,
			recruiterId: request.recruiterId === 'null' ? null : request.recruiterId,
			isIrp: request.isIrp != undefined ? parseBoolean(request.isIrp) : undefined,
			isMarketplace:
				request.isMarketplace != undefined ? parseBoolean(request.isMarketplace) : undefined,
			isDeactivated:
				request.isDeactivated != undefined ? parseBoolean(request.isDeactivated) : undefined,
			orderBy: request.orderBy,
			skip: isInteger(request.skip) ? parseInt(request.skip) : 0,
			limit: isInteger(request.limit) ? parseInt(request.limit) : 10,
			status: request.status,
			statusCounts:
				request.statusCounts != undefined ? parseBoolean(request.statusCounts) : undefined,
			search: tryParse<AdvancedSearch>(request.search) || request.search,
			isSuspended: request.isSuspended != undefined ? parseBoolean(request.isSuspended) : undefined,
			select: tryParse<any>(request.select, { _id: 1 }),
		});

		return toJson(result);
	} catch (err) {
		err = toHttpError(err);

		throw err;
	}
}
