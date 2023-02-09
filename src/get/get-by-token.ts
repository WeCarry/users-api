import { getConnection } from '@carry/data-access/mongodb/connection';
import { User } from '@carry/praos/user/user';
import { MongoDbDataDriver } from '@carry/data-access/mongodb/data-driver';
import { DataSourceCollection } from '@carry/data-access/data-source-collection';
import { HospitalRepository } from '@carry/praos/hospital/hospital-repository';
import { ProfessionalRepository } from '@carry/praos/professional/professional-repository';
import { DepartmentRepository } from '@carry/praos/department/department-repository';
import { ShareExpiredError } from '@carry/praos/errors';
import { UnauthorizedError } from '@carry/core/errors';
import { SettingsRepository } from '@carry/data-access/settings-repository';
import { ServerSettings, SERVER_SETTINGS } from '@carry/praos/settings/server-settings';
import { Professional } from '@carry/praos/professional/professional';
import { UserRepository } from '@carry/praos/user/user-repository';

export type ExecuteOptions = {
	db: {
		uri: string;
		dbName: string;
		poolSize: number;
	};
	userId: string;
	verificationToken?: string;
	shareToken?: string;
	passwordResetToken?: string;
};

export async function getProfessionalByToken(options: ExecuteOptions): Promise<User> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSource = new DataSourceCollection();
	const [professionals, settings] = dataSource.add(
		new ProfessionalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new SettingsRepository({
			useEnvVariables: true,
			driver: new MongoDbDataDriver(connection, options.db.dbName),
		}),
		new UserRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, options.db.dbName))
	);

	const serverSettings = await settings.getSettings<ServerSettings>(SERVER_SETTINGS);
	let user: Professional;

	if (options.shareToken) {
		const share = await professionals.getBriefcaseShare(options.userId, options.shareToken);

		if (!share || share.expiresAt < new Date()) {
			throw new ShareExpiredError();
		}

		user = await professionals.findById(
			options.userId,
			professionals.buildShareSelect(share.access)
		);

		if (share.access !== 'full') {
			if (user.dateOfBirth) {
				(user as any).dateOfBirth = true;
			}

			if (user.ssn) {
				(user as any).ssn = true;
			}
		}
	} else {
		user = await professionals.findById(options.userId, {
			firstName: 1,
			lastName: 1,
			email: 1,
			phoneNumber: 1,
			profession: 1,
			isMarketplace: 1,
			verificationToken: 1,
			verificationTokenExpiresAt: 1,
			passwordResetToken: 1,
			passwordResetTokenExpiresAt: 1,
			'affiliations.organization.name': 1,
			'affiliations.organization.coBrandedUrl': 1,
			'affiliations.organization.facility.logoURL': 1,
			'affiliations.organization.facility.bannerURL': 1,
			'affiliations.createdAt': 1,
			'affiliations.rejectedAt': 1,
		});

		if (
			!user ||
			(options.verificationToken &&
				(user.verificationToken !== options.verificationToken ||
					user.verificationTokenExpiresAt < new Date())) ||
			(options.passwordResetToken &&
				(user.passwordResetToken !== options.passwordResetToken ||
					user.passwordResetTokenExpiresAt < new Date()))
		) {
			throw new UnauthorizedError();
		}

		delete user.verificationToken;
		delete user.verificationTokenExpiresAt;
		delete user.passwordResetToken;
		delete user.passwordResetTokenExpiresAt;

		if (user.affiliations) {
			user.affiliations = user.affiliations.filter((i) => !i.rejectedAt);
		}
	}

	professionals.populateDownloadUrls(
		user,
		`${serverSettings.api2Url}/professional/${user._id.toString()}/documents/`
	);

	return user;
}
