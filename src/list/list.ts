import { midnight } from '@carry/core/utilities/date';
import { clone, isEmptyObject } from '@carry/core/utilities/object';
import { DataSourceCollection } from '@carry/data-access/data-source-collection';
import { getConnection } from '@carry/data-access/mongodb/connection';
import { MongoDbDataDriver } from '@carry/data-access/mongodb/data-driver';
import { DepartmentRepository } from '@carry/praos/department/department-repository';
import { UserNotFoundError } from '@carry/praos/errors';
import { HospitalRepository } from '@carry/praos/hospital/hospital-repository';
import { UserRepository } from '@carry/praos/user/user-repository';
import { OrganizationUser } from '@carry/praos/organization-user/organization-user';
import { Professional } from '@carry/praos/professional/professional';
import { ProfessionalRepository } from '@carry/praos/professional/professional-repository';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { isHospitalUser, UserType } from '@carry/praos/user/user-type';
import { escapeRegExp } from '@carry/core/utilities/regexp';
import { isInteger } from '@carry/core/utilities/string';
import { StateRepository } from '@carry/praos/state/state-repository';
import { LicenseBodyRepository } from '@carry/praos/license-body/license-body-repository';

export type AdvancedSearch = {
	text?: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	city?: string;
	state?: string;
	zip?: string;
	licenseBody?: string;
	licenseNumber?: string;
	licenseType?: string;
	specialty?: string | string[];
	certification?: string;
	additionalCertification?: string;
	thirdPartySystem?: {
		thirdPartySystemId: string;
		organizationId: string;
	};
};

export type ListOrderBy =
	| 'intId'
	| '!intId'
	| 'status'
	| '!status'
	| 'name'
	| '!name'
	| 'phoneNumber'
	| '!phoneNumber'
	| 'email'
	| '!email'
	| 'licenseType'
	| '!licenseType';

export type ExecuteOptions = {
	db: {
		uri: string;
		dbName: string;
		poolSize: number;
	};
	session?: JwtSession;
	profession?: string;
	organizationId?: string;
	departmentId?: string;
	recruiterId?: string;
	isIrp?: boolean;
	isMarketplace?: boolean;
	isDeactivated?: boolean;
	orderBy: ListOrderBy;
	limit?: number;
	skip?: number;
	status?: 'NOT_ACTIVE' | 'ACTIVATED' | 'ISSUES' | 'ACTIVE' | 'LICENSED' | 'COMPLETED';
	statusCounts?: boolean;
	search?: string | AdvancedSearch;
	isSuspended?: boolean;
	select?: any;
};

export type ListResponse = {
	list: Professional[];
	count: number;
	leadCount?: number;
	registeredCount?: number;
	licensedCount?: number;
	completedCount?: number;
	issuesCount?: number;
	activeCount?: number;
};

type ListCounts = {
	leadCount: number;
	registeredCount: number;
	licensedCount: number;
	completedCount: number;
	issuesCount: number;
	activeCount: number;
};

export async function listProfessionals(options: ExecuteOptions): Promise<ListResponse> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSources = new DataSourceCollection();
	const where: any = { userType: UserType.Nurse };
	const pipeline: any[] = [];
	const affiliationWhere: any = {};
	const and: any[] = [];
	let countWhere: any;
	let orderBy: any = { intId: -1 };
	let noResults = false;
	const [users, professionals, organizations, departments, states, licenseBodies] = dataSources.add(
		new UserRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new ProfessionalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new StateRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new LicenseBodyRepository(new MongoDbDataDriver(connection, options.db.dbName))
	);

	const sessionUser = await users.findById(options.session.userId, {
		userType: 1,
		organization: 1,
	});

	if (!sessionUser) {
		throw new UserNotFoundError();
	}

	pipeline.push({ $match: where });

	if (isHospitalUser(sessionUser.userType)) {
		options.organizationId = (sessionUser as OrganizationUser).organization._id.toString();
	}

	if (options.organizationId) {
		affiliationWhere.organization = organizations.toId(options.organizationId);
	}

	if (options.departmentId) {
		affiliationWhere.department = departments.toId(options.departmentId);
	}

	if (options.isIrp !== undefined) {
		affiliationWhere.acceptedAt = { $exists: options.isIrp };
	}

	if (options.recruiterId === null) {
		affiliationWhere.recruiter = { $exists: false };
		affiliationWhere.recruiterObj = { $exists: false };
	} else if (options.recruiterId) {
		affiliationWhere.recruiter = users.toId(options.recruiterId);
	}

	if (options.profession) {
		where.profession = options.profession;
	}

	if (options.isMarketplace !== undefined) {
		where.isMarketplace = options.isMarketplace;
	}

	if (options.isDeactivated !== undefined) {
		where.deactivatedAt = { $exists: options.isDeactivated };
	}

	if (
		options.select &&
		Object.keys(options.select).some((i) => i === 'affiliations' || i.startsWith('affiliations.'))
	) {
		const filter: any = {
			input: '$affiliations',
			cond: {
				$and: [{ $eq: [{ $type: '$$this.rejectedAt' }, 'missing'] }],
			},
		};

		if (isHospitalUser(sessionUser.userType)) {
			filter.cond.$and.push({
				$eq: ['$$this.organization', (sessionUser as OrganizationUser).organization._id],
			});
		}

		pipeline.push({
			$addFields: {
				affiliations: {
					$filter: filter,
				},
			},
		});
	}

	if (options.isSuspended !== undefined) {
		if (
			where.suspendedAt?.$exists !== undefined &&
			where.suspendedAt.$exists != options.isSuspended
		) {
			noResults = true;
		}

		where.suspendedAt = { $exists: options.isSuspended };
	}

	if (options.search) {
		const textSearch = typeof options.search === 'string' ? options.search : options.search.text;

		if (typeof textSearch === 'string') {
			for (let searchItem of textSearch.split(' ').filter(Boolean)) {
				searchItem = searchItem.toLowerCase();

				const stateList = await states
					.find({ name: { $regex: new RegExp(`^${escapeRegExp(searchItem)}`, 'i') } }, { abbr: 1 })
					.toArray();

				const or: any[] = [
					{ firstName: { $regex: new RegExp(`^${escapeRegExp(searchItem)}`, 'i') } },
					{ lastName: { $regex: new RegExp(`^${escapeRegExp(searchItem)}`, 'i') } },
					{ email: { $regex: new RegExp(`^${escapeRegExp(searchItem)}`, 'i') } },
					{ 'address.address1': { $regex: new RegExp(escapeRegExp(searchItem), 'i') } },
					{ 'address.city': { $regex: new RegExp(`^${escapeRegExp(searchItem)}`, 'i') } },
					{
						'briefcase.licenses.licenseNumber': {
							$regex: new RegExp(`^${escapeRegExp(searchItem)}$`, 'i'),
						},
					},
					{
						'briefcase.licenses.licenseType': {
							$regex: new RegExp(`^${escapeRegExp(searchItem)}$`, 'i'),
						},
					},
				];

				if (isInteger(searchItem)) {
					or.push(
						{ phoneNumber: { $regex: new RegExp(`^${escapeRegExp(searchItem)}$`, 'i') } },
						{ intId: parseInt(searchItem) },
						{ 'address.zip': searchItem }
					);
				}

				for (const abbr of [searchItem.toUpperCase()]
					.concat(stateList.map((i) => i.abbr))
					.filter((v, i, a) => a.indexOf(v) === i)) {
					or.push({ 'address.state': abbr });
				}

				and.push({ $or: or });
			}
		}

		if (options.search instanceof Object) {
			if (options.search.firstName) {
				and.push({
					firstName: { $regex: new RegExp(`^${escapeRegExp(options.search.firstName)}`, 'i') },
				});
			}

			if (options.search.lastName) {
				and.push({
					lastName: { $regex: new RegExp(`^${escapeRegExp(options.search.lastName)}`, 'i') },
				});
			}

			if (options.search.email) {
				and.push({ email: { $regex: new RegExp(`^${escapeRegExp(options.search.email)}`, 'i') } });
			}

			if (options.search.city) {
				and.push({
					'address.city': { $regex: new RegExp(`^${escapeRegExp(options.search.city)}`, 'i') },
				});
			}

			if (options.search.state) {
				const stateList = await states
					.find(
						{ name: { $regex: new RegExp(`^${escapeRegExp(options.search.state)}`, 'i') } },
						{ abbr: 1 }
					)
					.toArray();
				const or: any[] = [];

				for (const abbr of [options.search.state.toUpperCase()]
					.concat(stateList.map((i) => i.abbr))
					.filter((v, i, a) => a.indexOf(v) === i)) {
					or.push({ 'address.state': abbr });
				}

				if (or.length) {
					and.push({ $or: or });
				}
			}

			if (options.search.zip && isInteger(options.search.zip)) {
				and.push({ 'address.zip': options.search.zip });
			}

			if (options.search.licenseBody) {
				and.push({
					'briefcase.licenses.licenseBody': {
						$regex: new RegExp(`^${escapeRegExp(options.search.licenseBody)}$`, 'i'),
					},
				});
			}

			if (options.search.licenseNumber) {
				and.push({
					'briefcase.licenses.licenseNumber': {
						$regex: new RegExp(`^${escapeRegExp(options.search.licenseNumber)}$`, 'i'),
					},
				});
			}

			if (options.search.licenseType) {
				and.push({
					'briefcase.licenses.licenseType': {
						$regex: new RegExp(`^${escapeRegExp(options.search.licenseType)}$`, 'i'),
					},
				});
			}

			if (typeof options.search.specialty === 'string') {
				and.push({
					'briefcase.specialties': {
						$regex: new RegExp(`^${escapeRegExp(options.search.specialty)}`, 'i'),
					},
				});
			} else if (options.search.specialty?.length) {
				const or = { $or: [] };

				for (const specialty of options.search.specialty) {
					or.$or.push({
						'briefcase.specialties': { $regex: new RegExp(`^${escapeRegExp(specialty)}$`, 'i') },
					});
				}

				and.push(or);
			}

			if (options.search.certification) {
				and.push({
					'briefcase.certifications.name': {
						$regex: new RegExp(`^${escapeRegExp(options.search.certification)}$`, 'i'),
					},
				});
			}

			if (options.search.additionalCertification) {
				and.push({
					'briefcase.additionalCertifications.name': {
						$regex: new RegExp(`^${escapeRegExp(options.search.additionalCertification)}$`, 'i'),
					},
				});
			}

			if (options.search.thirdPartySystem) {
				and.push({
					'affiliations.thirdPartySystems.id': String(
						options.search.thirdPartySystem.thirdPartySystemId
					),
					'affiliations.organization': organizations.toId(
						options.search.thirdPartySystem.organizationId
					),
				});
			}
		}
	}

	if (!isEmptyObject(affiliationWhere)) {
		affiliationWhere.rejectedAt = { $exists: false };
		where.affiliations = { $elemMatch: affiliationWhere };
	}

	countWhere = clone(where);

	if (and.length) {
		countWhere.$and = clone(and);
	}

	switch (options.status) {
		case 'NOT_ACTIVE':
			where.activatedAt = { $exists: false };
			break;
		case 'ACTIVATED':
			where.activatedAt = { $exists: true };
			where['briefcase.licensedAt'] = { $exists: false };
			break;
		case 'ISSUES':
			and.push({
				$or: [
					{ activatedAt: { $exists: false } },
					{ 'briefcase.licensedAt': { $exists: false } },
					{ suspendedAt: { $exists: true } },
					{
						affiliations: {
							$elemMatch: {
								suspendedAt: { $exists: true },
							},
						},
					},
				],
			});
			break;
		case 'ACTIVE':
			where.activatedAt = { $exists: true };
			where.suspendedAt = { $exists: false };
			where['briefcase.licensedAt'] = { $exists: true };
			where['affiliations']['$elemMatch']['suspendedAt'] = { $exists: false };
			break;
		case 'LICENSED':
			where.activatedAt = { $exists: true };
			where['briefcase.licensedAt'] = { $exists: true };
			where['briefcase.completedAt'] = { $exists: false };
			break;
		case 'COMPLETED':
			where.activatedAt = { $exists: true };
			where['briefcase.licensedAt'] = { $exists: true };
			where['briefcase.completedAt'] = { $exists: true };
			break;
		default:
			break;
	}

	if (and.length) {
		where.$and = and;
	}

	switch (options.orderBy) {
		case 'intId':
			orderBy = { intId: 1 };
			break;
		case '!intId':
			orderBy = { intId: -1 };
			break;
		case 'status':
			orderBy = {
				suspendedAt: 1,
				'briefcase.completedAt': 1,
				'briefcase.licensedAt': 1,
				activatedAt: 1,
				lastName: 1,
				firstName: 1,
			};
			break;
		case '!status':
			orderBy = {
				suspendedAt: -1,
				'briefcase.completedAt': -1,
				'briefcase.licensedAt': -1,
				activatedAt: -1,
				lastName: -1,
				firstName: -1,
			};
			break;
		case 'name':
			orderBy = { lastName: 1, firstName: 1 };
			break;
		case '!name':
			orderBy = { lastName: -1, firstName: -1 };
			break;
		case 'phoneNumber':
			orderBy = { phoneNumber: 1 };
			break;
		case '!phoneNumber':
			orderBy = { phoneNumber: -1 };
			break;
		case 'email':
			orderBy = { email: 1 };
			break;
		case '!email':
			orderBy = { email: -1 };
			break;
		case 'licenseType':
			orderBy = { 'briefcase.licenses.0.licenseType': 1 };
			break;
		case '!licenseType':
			orderBy = { 'briefcase.licenses.0.licenseType': -1 };
			break;

		default:
			break;
	}

	let list: Professional[] = [];
	let count: number;
	let statusCounts: ListCounts;

	if (!noResults) {
		pipeline.push({ $project: professionals.buildSelect(options.select) });

		[list, count, statusCounts] = await Promise.all([
			professionals.aggregate(pipeline, orderBy, options.skip, options.limit).toArray(),
			professionals.count(where),
			options.statusCounts && options.organizationId
				? getCounts(professionals, organizations, countWhere, options.organizationId)
				: undefined,
		]);

		if (list.length && options.select['briefcase.licenses']) {
			const allLicenseBodies = await licenseBodies.getStateLookup();

			for (const item of list) {
				if (item.briefcase?.licenses)
					for (const lic of item.briefcase.licenses) {
						(lic as any).licenseState = allLicenseBodies[lic.licenseBody];
					}
			}
		}
	}

	return {
		list,
		count: count,
		leadCount: statusCounts?.leadCount,
		registeredCount: statusCounts?.registeredCount,
		licensedCount: statusCounts?.licensedCount,
		completedCount: statusCounts?.completedCount,
		issuesCount: statusCounts?.issuesCount,
		activeCount: statusCounts?.activeCount,
	};
}

async function getCounts(
	professionals: ProfessionalRepository,
	organizations: HospitalRepository,
	where: any,
	organizationId: string
): Promise<ListCounts> {
	const counts = await professionals
		.aggregate<ListCounts>([
			{
				$match: where,
			},
			{
				$addFields: {
					affiliations: {
						$filter: {
							input: '$affiliations',
							cond: {
								$eq: ['$$this.organization', organizations.toId(organizationId)],
							},
						},
					},
				},
			},
			{
				$unwind: '$affiliations',
			},
			{
				$group: {
					_id: null,
					leadCount: {
						$sum: {
							$switch: {
								branches: [
									{
										case: {
											$and: [
												{ $eq: [{ $type: '$affiliations.acceptedAt' }, 'missing'] },
												{ $eq: [{ $type: '$activatedAt' }, 'missing'] },
											],
										},
										then: 1,
									},
								],
								default: 0,
							},
						},
					},
					registeredCount: {
						$sum: {
							$switch: {
								branches: [
									{
										case: {
											$and: [
												{ $eq: [{ $type: '$affiliations.acceptedAt' }, 'missing'] },
												{ $ne: [{ $type: '$activatedAt' }, 'missing'] },
												{ $eq: [{ $type: '$briefcase.licensedAt' }, 'missing'] },
											],
										},
										then: 1,
									},
								],
								default: 0,
							},
						},
					},
					licensedCount: {
						$sum: {
							$switch: {
								branches: [
									{
										case: {
											$and: [
												{ $eq: [{ $type: '$affiliations.acceptedAt' }, 'missing'] },
												{ $ne: [{ $type: '$activatedAt' }, 'missing'] },
												{ $ne: [{ $type: '$briefcase.licensedAt' }, 'missing'] },
												{ $eq: [{ $type: '$briefcase.completedAt' }, 'missing'] },
											],
										},
										then: 1,
									},
								],
								default: 0,
							},
						},
					},
					completedCount: {
						$sum: {
							$switch: {
								branches: [
									{
										case: {
											$and: [
												{ $eq: [{ $type: '$affiliations.acceptedAt' }, 'missing'] },
												{ $ne: [{ $type: '$activatedAt' }, 'missing'] },
												{ $ne: [{ $type: '$briefcase.licensedAt' }, 'missing'] },
												{ $ne: [{ $type: '$briefcase.completedAt' }, 'missing'] },
											],
										},
										then: 1,
									},
								],
								default: 0,
							},
						},
					},
					issuesCount: {
						$sum: {
							$switch: {
								branches: [
									{
										case: {
											$and: [
												{ $ne: [{ $type: '$affiliations.acceptedAt' }, 'missing'] },
												{
													$or: [
														{ $eq: [{ $type: '$activatedAt' }, 'missing'] },
														{ $eq: [{ $type: '$briefcase.licensedAt' }, 'missing'] },
														{ $ne: [{ $type: '$suspendedAt' }, 'missing'] },
													],
												},
											],
										},
										then: 1,
									},
								],
								default: 0,
							},
						},
					},
					activeCount: {
						$sum: {
							$switch: {
								branches: [
									{
										case: {
											$and: [
												{ $ne: [{ $type: '$affiliations.acceptedAt' }, 'missing'] },
												{ $ne: [{ $type: '$activatedAt' }, 'missing'] },
												{ $ne: [{ $type: '$briefcase.licensedAt' }, 'missing'] },
												{ $eq: [{ $type: '$suspendedAt' }, 'missing'] },
											],
										},
										then: 1,
									},
								],
								default: 0,
							},
						},
					},
				},
			},
		])
		.toArray();

	return counts.length
		? counts[0]
		: {
				leadCount: 0,
				registeredCount: 0,
				licensedCount: 0,
				completedCount: 0,
				issuesCount: 0,
				activeCount: 0,
		  };
}
