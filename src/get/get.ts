import { getConnection } from '@carry/data-access/mongodb/connection';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { User } from '@carry/praos/user/user';
import { MongoDbDataDriver } from '@carry/data-access/mongodb/data-driver';
import { DataSourceCollection } from '@carry/data-access/data-source-collection';
import { HospitalRepository } from '@carry/praos/hospital/hospital-repository';
import { ProfessionalRepository } from '@carry/praos/professional/professional-repository';
import { DepartmentRepository } from '@carry/praos/department/department-repository';
import { UnauthorizedError } from '@carry/core/errors';
import { isAdminUser, isHospitalUser, UserType } from '@carry/praos/user/user-type';
import { hasAccess } from '@carry/praos/professional/professional';
import { SettingsRepository } from '@carry/data-access/settings-repository';
import { ServerSettings, SERVER_SETTINGS } from '@carry/praos/settings/server-settings';
import { UserNotFoundError } from '@carry/praos/errors';
import { UserRepository } from '@carry/praos/user/user-repository';
import { OrganizationUser } from '@carry/praos/organization-user/organization-user';
import { LicenseBodyRepository } from '@carry/praos/license-body/license-body-repository';
import { ShareAccess } from '@carry/praos/professional/share';
import { SessionRepository } from '@carry/praos/session/session-repository';

export type ExecuteOptions = {
	db: {
		uri: string;
		dbName: string;
		poolSize: number;
	};
	session: JwtSession;
	userId: string;
	select: any | ShareAccess;
};

export async function getProfessional(options: ExecuteOptions): Promise<User> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSource = new DataSourceCollection();
	const [professionals, settings, users, sessions, licenseBodies] = dataSource.add(
		new ProfessionalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new SettingsRepository({
			useEnvVariables: true,
			driver: new MongoDbDataDriver(connection, options.db.dbName),
		}),
		new UserRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new SessionRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new LicenseBodyRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, options.db.dbName))
	);

	const [serverSettings, sessionUser, session] = await Promise.all([
		settings.getSettings<ServerSettings>(SERVER_SETTINGS),
		users.findById(options.session.userId, {
			userType: 1,
			organization: 1,
		}),
		sessions.findById(options.session.id, {
			invalidatedAt: 1,
		}),
	]);

	if (!session || session.invalidatedAt) {
		throw new UnauthorizedError();
	}

	if (!sessionUser) {
		throw new UserNotFoundError();
	}

	if (!options.userId) {
		if (sessionUser.userType !== UserType.Nurse) {
			return;
		}

		options.userId = sessionUser._id;
	}

	const shareAccess =
		typeof options.select === 'string' ? (options.select as ShareAccess) : undefined;
	const select = shareAccess
		? professionals.buildShareSelect(shareAccess)
		: professionals.buildSelect(options.select);

	if (isHospitalUser(options.session.userType)) {
		Object.assign(select, {
			isMarketplace: 1,
			'affiliations.organization': 1,
			'affiliations.acceptedAt': 1,
			'affiliations.rejectedAt': 1,
		});
	}

	if (isAdminUser(options.session.userType)) {
		Object.assign(select, {
			'affiliations.thirdPartySystems': 1,
		});
	}

	const user = await professionals.findOne(
		Object.assign(
			{
				userType: UserType.Nurse,
			},
			professionals.buildByIdClause(options.userId)
		),
		select
	);

	if (user) {
		if (!hasAccess(sessionUser, user)) {
			throw new UnauthorizedError();
		}

		if (shareAccess || (select.isMarketplace && !options.select?.isMarketplace)) {
			delete user.isMarketplace;
		}

		if (
			shareAccess ||
			!options.select ||
			!Object.keys(options.select).some(
				(i) => i === 'affiliations' || i.startsWith('affiliations.')
			)
		) {
			delete user.affiliations;
		} else if (user.affiliations) {
			user.affiliations = user.affiliations.filter(
				(i) =>
					!i.rejectedAt &&
					(!isHospitalUser(sessionUser.userType) ||
						i.organization._id.toString() ===
							(sessionUser as OrganizationUser).organization._id.toString())
			);

			if (!user.affiliations.length) {
				delete user.affiliations;
			}
		}

		if (shareAccess && shareAccess !== 'full') {
			if (user.dateOfBirth) {
				(user as any).dateOfBirth = true;
			}

			if (user.ssn) {
				(user as any).ssn = true;
			}
		}

		professionals.populateDownloadUrls(
			user,
			`${serverSettings.api2Url}/professional/${user._id.toString()}/documents/`
		);

		if (shareAccess || options.select?.['briefcase.licenses']) {
			const allLicenseBodies = await licenseBodies.getStateLookup();

			if (user.briefcase?.licenses) {
				for (const lic of user.briefcase.licenses) {
					(lic as any).licenseState = allLicenseBodies[lic.licenseBody];
				}
			}
		}
	}

	return user;
}
