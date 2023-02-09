import { MultipleErrors, UnauthorizedError } from '@carry/core/errors';
import { addDays, midnight } from '@carry/core/utilities/date';
import {
	isEmpty,
	isEmptyObject,
	toJson,
	unflatten,
	UnflattenFieldError,
	UnflattenFieldRequiredError,
	UnflattenOptions,
} from '@carry/core/utilities/object';
import { EMAIL_REG_EXP, URL_REG_EXP } from '@carry/core/utilities/regexp';
import { DataSourceCollection } from '@carry/data-access/data-source-collection';
import { getConnection } from '@carry/data-access/mongodb/connection';
import { MongoDbDataDriver } from '@carry/data-access/mongodb/data-driver';
import { SETTINGS_IDENTIFIER, SettingsRepository } from '@carry/data-access/settings-repository';
import { JobRepository, JOBS_IDENTIFIER } from '@carry/jobs/job-repository';
import { AdditionalCertificationRepository } from '@carry/praos/additional-certification/additional-certification-repository';
import { CertificationRepository } from '@carry/praos/certification/certification-repository';
import { CITIES_IDENTIFIER, CityRepository } from '@carry/praos/city/city-repository';
import { Department } from '@carry/praos/department/department';
import {
	DepartmentRepository,
	DEPARTMENTS_IDENTIFIER,
} from '@carry/praos/department/department-repository';
import { EducationLevelRepository } from '@carry/praos/education-level/education-level-repository';
import {
	AccountAlreadyExistsError,
	AddAffiliationRequiredError,
	DeactivatedAccountError,
	DepartmentNotFoundError,
	OrganizationNotFoundError,
	PasswordRequiredError,
	ProfessionAlreadyAssignedError,
	UserNotFoundError,
} from '@carry/praos/errors';
import { ExternalSource } from '@carry/praos/external-source/externalSource';
import { Hospital } from '@carry/praos/hospital/hospital';
import {
	Branding,
	getOrganizationBrandingSelect,
	HospitalRepository,
	HOSPITALS_IDENTIFIER,
} from '@carry/praos/hospital/hospital-repository';
import { JACKSON_SETTINGS, JnpSettings } from '@carry/praos/jnp/jnp-settings';
import { LicenseBodyRepository } from '@carry/praos/license-body/license-body-repository';
import { LicenseTypeRepository } from '@carry/praos/license-type/license-type-repository';
import {
	AppNotificationRepository,
	NOTIFICATIONS_IDENTIFIER,
} from '@carry/praos/notification/app-notification-repository';
import { NotificationService, SendOptions } from '@carry/praos/notification/notification-service';
import {
	NOTIFICATION_SETTINGS,
	NotificationSettings,
} from '@carry/praos/notification/notification-settings';
import { OrganizationUser } from '@carry/praos/organization-user/organization-user';
import {
	ORGANIZATION_USERS_IDENTIFIER,
	OrganizationUserRepository,
} from '@carry/praos/organization-user/organization-user-repository';
import { Affiliation } from '@carry/praos/professional/affiliation';
import { ALL_EXPERIENCE_LEVELS, parseExperienceLevel } from '@carry/praos/professional/briefcase';
import { ALL_HEALTH_DOCUMENT_REASONS } from '@carry/praos/professional/health-document';
import { WorkCity } from '@carry/praos/professional/job-info';
import { Professional } from '@carry/praos/professional/professional';
import {
	ProfessionalRepository,
	PROFESSIONALS_IDENTIFIER,
} from '@carry/praos/professional/professional-repository';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { SERVER_SETTINGS, ServerSettings } from '@carry/praos/settings/server-settings';
import { SpecialtyRepository } from '@carry/praos/specialty/specialty-repository';
import { StateRepository } from '@carry/praos/state/state-repository';
import { ThirdPartySystems } from '@carry/praos/thirdPartySystems/thirdPartySystems';
import {
	USER_AUDIT_TRAIL_IDENTIFIER,
	UserAuditTrailRepository,
} from '@carry/praos/user-audit-trail/user-audit-trail-repository';
import { formatPhoneNumber, Gender, generateVerificationToken, User } from '@carry/praos/user/user';
import { UserRepository, USERS_IDENTIFIER } from '@carry/praos/user/user-repository';
import { isHospitalUser, UserType } from '@carry/praos/user/user-type';
import { Webhook } from '@carry/praos/webhook/webhook';
import {
	URL_SHORTENER_IDENTIFIER,
	UrlShortenerRepository,
} from '@carry/url-shortener/url-shortener-repository';
import { SNS } from 'aws-sdk';
import bcryptjs from 'bcryptjs';
import csvParser from 'csv-parser';
import { MongoClient } from 'mongodb';
import { Readable } from 'stream';

const ALL_GENDERS = [Gender.Male, Gender.Female, Gender.Other];

export type DatabaseOptions = {
	db: {
		uri: string;
		dbName: string;
		poolSize: number;
	};
};

export type BulkAddOptions = {
	session: JwtSession;
	authToken: string;
	webhookTopicArn: string;
	csv: string;
};

export type AddOptions = {
	sessionUser: User;
	user: Professional;
	notificationService: NotificationService;
	serverSettings: ServerSettings;
	jnpSettings: JnpSettings;
	webhookTopicArn: string;
	select: any;
	thirdPartyId: string;
	thirdPartySystems?: ThirdPartySystems[];
	recruiter: OrganizationUser;
	departmentId: string;
	notes?: string;
	organization: Hospital;
	isIrpAdd: boolean;
	external?: boolean;
	externalSource?: ExternalSource;
};

export type ExecuteOptions = {
	authToken: string;
	db: {
		uri: string;
		dbName: string;
		poolSize: number;
	};
	webhookTopicArn: string;
	session?: JwtSession;
	item: Professional;
	ipAddress: string;
	signupChannel?: string;
	select?: any;
	password?: string;
	organizationId?: string;
	departmentId?: string;
	thirdPartyId?: string;
	thirdPartySystems?: ThirdPartySystems[];
	recruiter?: string | OrganizationUser;
	notes?: string;
	jobId?: string;
	external?: boolean;
	externalSource?: ExternalSource;
	isIrp?: boolean;
};

export type BulkAddResult = {
	row: number;
	user?: User;
	errors?: Error[];
};

export type ExternalExecuteOptions = {
	webhookTopicArn: string;
	entityIdUpdateTopicArn: string;
	authToken: string;
	db: {
		uri: string;
		dbName: string;
		poolSize: number;
	};
	item: Professional & {
		status?: string;
		thirdPartyRecruiterId?: string | number;
		thirdPartySystems?: ThirdPartySystems[];
	};
	organizationId: string;
};

export type ProfessionalWithAffiliation = Professional & {
	affiliation: {
		thirdPartyId?: string;
		recruiter: OrganizationUser;
		notes: string;
		department: string;
		isIrp: boolean;
	};
};

export async function addProfessional(options: ExecuteOptions): Promise<User> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSources = createDataSources(connection, options.db.dbName);

	let sessionUser: User;

	if (options.external && options.jobId) {
		// coming from external source/job board. send recruiter email
		try {
			await sendJobBoardRecruiterEmail(options);
		} catch (e) {
			console.log(e);
		}
	}

	if (options.session) {
		sessionUser = await getSessionUser(dataSources, options.session.userId);
	} else if (!options.external && !options.password) {
		throw new PasswordRequiredError();
	}

	const settings = dataSources.get<SettingsRepository>(SETTINGS_IDENTIFIER);
	const appNotifications = dataSources.get<AppNotificationRepository>(NOTIFICATIONS_IDENTIFIER);
	const organizationUsers = dataSources.get<OrganizationUserRepository>(
		ORGANIZATION_USERS_IDENTIFIER
	);
	const [serverSettings, notificationSettings, jnpSettings] = await Promise.all([
		settings.getSettings<ServerSettings>(SERVER_SETTINGS),
		settings.getSettings<NotificationSettings>(NOTIFICATION_SETTINGS),
		settings.getSettings<JnpSettings>(JACKSON_SETTINGS),
	]);

	const notificationService = new NotificationService({
		appNotifications: appNotifications,
		notifyUrl: notificationSettings.notifyUrl,
		registerUrl: notificationSettings.registerUrl,
		unregisterUrl: notificationSettings.unregisterUrl,
		authToken: options.authToken,
	});

	const [organization, recruiter] = await Promise.all([
		getOrganization(dataSources, sessionUser, options.organizationId),
		typeof options.recruiter !== 'string'
			? options.recruiter
			: organizationUsers.findById(options.recruiter, { _id: 1 }),
	]);

	if (typeof options.recruiter === 'string' && !recruiter) {
		throw new UserNotFoundError();
	}

	const user =
		sessionUser || options.external
			? options.item
			: {
					profession: options.item.profession,
					firstName: options.item.firstName,
					lastName: options.item.lastName,
					email: options.item.email,
					phoneNumber: options.item.phoneNumber,
					facebookId: options.item.facebookId,
					linkedInId: options.item.linkedInId,
			  };

	user.signupIpAddress = options.ipAddress;

	if (sessionUser?.userType === UserType.HospitalApi) {
		user.signupChannel = 'API';
	} else if (options.signupChannel) {
		user.signupChannel = options.signupChannel;
	} else {
		user.signupChannel = 'WEB';
	}

	if ((!options.external && !sessionUser) || (options.external && options.password)) {
		user.password = bcryptjs.hashSync(options.password, 10);
	}

	return await add(dataSources, {
		webhookTopicArn: options.webhookTopicArn,
		notificationService,
		jnpSettings,
		serverSettings,
		sessionUser,
		organization,
		user,
		select: options.select,
		recruiter,
		thirdPartyId: options.thirdPartyId,
		thirdPartySystems: options.thirdPartySystems,
		departmentId: options.departmentId,
		isIrpAdd:
			(sessionUser &&
				isHospitalUser(sessionUser.userType) &&
				!options.external &&
				options.isIrp !== false) ||
			(options.external && options.isIrp),
		external: options.external,
		externalSource: options.externalSource,
	});
}

export async function bulkAddProfessional(
	dbOptions: DatabaseOptions,
	options: BulkAddOptions
): Promise<BulkAddResult[]> {
	const connection = await getConnection(dbOptions.db.uri, dbOptions.db.poolSize, true);
	const dataSources = createDataSources(connection, dbOptions.db.dbName);
	const sessionUser = (await getSessionUser(
		dataSources,
		options.session.userId
	)) as OrganizationUser;

	if (!sessionUser) {
		throw new UserNotFoundError();
	}

	const settings = dataSources.get<SettingsRepository>(SETTINGS_IDENTIFIER);
	const appNotifications = dataSources.get<AppNotificationRepository>(NOTIFICATIONS_IDENTIFIER);
	const [serverSettings, notificationSettings, jnpSettings] = await Promise.all([
		settings.getSettings<ServerSettings>(SERVER_SETTINGS),
		settings.getSettings<NotificationSettings>(NOTIFICATION_SETTINGS),
		settings.getSettings<JnpSettings>(JACKSON_SETTINGS),
	]);

	const notificationService = new NotificationService({
		appNotifications: appNotifications,
		notifyUrl: notificationSettings.notifyUrl,
		registerUrl: notificationSettings.registerUrl,
		unregisterUrl: notificationSettings.unregisterUrl,
		authToken: options.authToken,
	});

	const organization = await getOrganization(dataSources, sessionUser);

	const [
		states,
		licenseBodies,
		licenseTypes,
		specialties,
		certifications,
		additionalCertifications,
		educationLevels,
	] = dataSources.add(
		new StateRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName)),
		new LicenseBodyRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName)),
		new LicenseTypeRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName)),
		new SpecialtyRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName)),
		new CertificationRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName)),
		new AdditionalCertificationRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName)),
		new EducationLevelRepository(new MongoDbDataDriver(connection, dbOptions.db.dbName))
	);

	const cities = dataSources.get<CityRepository>(CITIES_IDENTIFIER);
	const departments = dataSources.get<DepartmentRepository>(DEPARTMENTS_IDENTIFIER);

	const [
		allStates,
		allLicenseBodies,
		allLicenseTypes,
		allSpecialties,
		allCertifications,
		allAdditionalCertifications,
		allEducationlevels,
		allDepartments,
	] = await Promise.all([
		states.find({}, { name: 1, abbr: 1 }).toArray(),
		licenseBodies.find({}, { name: 1, state: 1 }).toArray(),
		licenseTypes.find({}, { profession: 1, abbr: 1, detailsRequired: 1 }).toArray(),
		specialties.find({}, { profession: 1, name: 1 }).toArray(),
		certifications.find({}, { profession: 1, name: 1 }).toArray(),
		additionalCertifications.find({}, { profession: 1, name: 1 }).toArray(),
		educationLevels.find({}, { profession: 1, name: 1 }).toArray(),
		departments.find({ organization: sessionUser.organization._id }, { name: 1 }).toArray(),
	]);

	const readable = Readable.from([options.csv]);
	const result: BulkAddResult[] = [];
	const userConfig: UnflattenOptions<ProfessionalWithAffiliation> = {
		fields: {
			firstName: {
				type: 'string',
				isRequired: true,
				parse: (value) => value.trim(),
				validations: [
					{
						regExp: /^[a-zA-Z,`~'"\-\.:; ]+$/,
						error: 'Only alpha, space, comma, `, ~, \', ", -, ., :, and ; are allowed.',
					},
				],
			},
			lastName: {
				type: 'string',
				isRequired: true,
				parse: (value) => value.trim(),
				validations: [
					{
						regExp: /^[a-zA-Z,`~'"\-\.:; ]+$/,
						error: 'Only alpha, space, comma, `, ~, \', ", -, ., :, and ; are allowed.',
					},
				],
			},
			email: {
				type: 'string',
				isRequired: true,
				parse: (value) => value.trim(),
				validations: [
					{
						regExp: EMAIL_REG_EXP,
						error: 'Invalid email address.',
					},
				],
			},
			phoneNumber: {
				type: 'string',
				parse: (value) => value.replace(/\D/g, ''),
				minLength: 10,
				maxLength: 10,
			},
			dateOfBirth: {
				type: 'date',
				parse: (value) => midnight(new Date(value), true),
			},
			gender: {
				type: 'string',
				parse: (value) => {
					value = value.trim();

					return ALL_GENDERS.find((item) => value.toLowerCase() === item.toLowerCase()) || value;
				},
				validate: (value) => ALL_GENDERS.some((i) => i === value),
			},
			'address.address1': {
				type: 'string',
				isRequired: true,
			},
			'address.address2': {
				type: 'string',
			},
			'address.city': {
				type: 'string',
				isRequired: true,
			},
			'address.state': {
				type: 'string',
				isRequired: true,
				parse: (value) => {
					value = value.trim();

					return (
						allStates.find(
							(item) =>
								value.toLowerCase() === item.abbr.toLowerCase() ||
								value.toLowerCase() === item.name.toLowerCase()
						)?.abbr || value
					);
				},
				validate: (value) => allStates.some((i) => i.abbr === value),
			},
			'address.zip': {
				type: 'string',
				isRequired: true,
				validations: [
					{
						regExp: /^[0-9]+$/,
						error: 'Only numeric characters are allowed.',
					},
				],
			},
			'affiliation.thirdPartyId': {
				type: 'string',
				validations: [
					{
						regExp: /^[a-zA-Z0-9]+$/,
						error: 'Only alpha-numeric characters are allowed.',
					},
				],
			},
			'affiliation.isIrp': {
				type: 'bool',
			},
			'affiliation.recruiter.firstName': {
				type: 'string',
				isRequired: true,
				validations: [
					{
						regExp: /^[a-zA-Z0-9 ]+$/,
						error: 'Only alpha-numeric characters are allowed.',
					},
				],
			},
			'affiliation.recruiter.lastName': {
				type: 'string',
				validations: [
					{
						regExp: /^[a-zA-Z0-9 ]+$/,
						error: 'Only alpha-numeric characters are allowed.',
					},
				],
			},
			'affiliation.recruiter.email': {
				type: 'string',
				validations: [
					{
						regExp: EMAIL_REG_EXP,
						error: 'Invalid email address.',
					},
				],
			},
			'affiliation.recruiter.phoneNumber': {
				type: 'string',
				parse: (value) => value.replace(/\D/g, ''),
				minLength: 10,
				maxLength: 10,
			},
			'affiliation.notes': {
				type: 'string',
			},
			'affiliation.department': {
				type: 'string',
				parse: (value) => {
					value = value.trim();

					return (
						allDepartments
							.find((i) => i.name.toLowerCase() === value.toLowerCase())
							?._id.toString() || value
					);
				},
				validate: (value) => allDepartments.some((i) => i._id.toString() === value),
			},
			'briefcase.additionalCertifications': {
				type: 'array',
			},
			'briefcase.additionalCertifications.name': {
				type: 'string',
				isRequired: true,
				parse: (value) => {
					value = value.trim();

					return (
						allAdditionalCertifications.find(
							(item) => value.toLowerCase() === item.name.toLowerCase()
						)?.name || value
					);
				},
				validate: (value) => {
					return allAdditionalCertifications.some((i) => i.name === value);
				},
			},
			'briefcase.additionalCertifications.eCardNumber': {
				type: 'string',
			},
			'briefcase.additionalCertifications.expirationDate': {
				type: 'date',
				isRequired: true,
				parse: (value) => midnight(new Date(value), true),
			},
			'briefcase.driversLicense.number': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.driversLicense.state': {
				type: 'string',
				isRequired: true,
				parse: (value) => {
					value = value.trim();

					return (
						allStates.find(
							(item) =>
								value.toLowerCase() === item.abbr.toLowerCase() ||
								value.toLowerCase() === item.name.toLowerCase()
						)?.abbr || value
					);
				},
				validate: (value) => allStates.some((i) => i.abbr === value),
			},
			'briefcase.driversLicense.expirationDate': {
				type: 'date',
				isRequired: true,
				parse: (value) => midnight(new Date(value), true),
			},
			'briefcase.education': {
				type: 'array',
			},
			'briefcase.education.institute': {
				type: 'string',
				isRequired: true,
				parse: (value) => value.trim(),
			},
			'briefcase.education.programName': {
				type: 'string',
				isRequired: true,
				parse: (value) => value.trim(),
			},
			'briefcase.education.status': {
				type: 'string',
			},
			'briefcase.education.yearFrom': {
				type: 'number',
				isInt: true,
			},
			'briefcase.education.yearTo': {
				type: 'number',
				isInt: true,
			},
			'briefcase.educationLevel': {
				type: 'string',
				parse: (value) => {
					value = value.trim();

					return (
						allEducationlevels.find((item) => value.toLowerCase() === item.name.toLowerCase())
							?.name || value
					);
				},
				validate: (value) => allEducationlevels.some((i) => i.name === value),
			},
			'briefcase.ehrSkills': {
				type: 'array',
				parse: (value) => {
					return value
						.split(',')
						.filter(Boolean)
						.map((i) => i.trim());
				},
			},
			'briefcase.facilities': {
				type: 'array',
			},
			'briefcase.facilities.name': {
				type: 'string',
				isRequired: true,
				parse: (value) => value.trim(),
			},
			'briefcase.facilities.city': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.facilities.state': {
				type: 'string',
				isRequired: true,
				parse: (value) => {
					value = value.trim();

					return (
						allStates.find(
							(item) =>
								value.toLowerCase() === item.abbr.toLowerCase() ||
								value.toLowerCase() === item.name.toLowerCase()
						)?.abbr || value
					);
				},
				validate: (value) => allStates.some((i) => i.abbr === value),
			},
			'briefcase.healthDocuments': {
				type: 'array',
			},
			'briefcase.healthDocuments.name': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.healthDocuments.reason': {
				type: 'string',
				parse: (value) => {
					value = value.trim();

					return (
						ALL_HEALTH_DOCUMENT_REASONS.find(
							(item) => value.toLowerCase() === item.toLowerCase()
						) || value
					);
				},
				validate: (value) => ALL_HEALTH_DOCUMENT_REASONS.some((i) => i === value),
			},
			'briefcase.healthDocuments.date': {
				type: 'date',
				isRequired: true,
				parse: (value) => midnight(new Date(value), true),
			},
			'briefcase.liabilityInsurance.company': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.liabilityInsurance.policyNumber': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.liabilityInsurance.expirationDate': {
				type: 'date',
				isRequired: true,
				parse: (value) => midnight(new Date(value), true),
			},
			'briefcase.licenses': {
				type: 'array',
			},
			'briefcase.licenses.licenseBody': {
				type: 'string',
				isRequired: false,
				parse: (value) => {
					value = value.trim();
					value =
						allStates.find(
							(item) =>
								value.toLowerCase() === item.name.toLowerCase() ||
								value.toLowerCase() === item.abbr.toLowerCase()
						)?.abbr || value;

					return (
						allLicenseBodies.find(
							(item) =>
								value.toLowerCase() === item.name.toLowerCase() ||
								value.toLowerCase() === item.state.toLowerCase()
						)?.name || value
					);
				},
				validate: (value) => allLicenseBodies.some((i) => i.name === value),
			},
			'briefcase.licenses.licenseType': {
				type: 'string',
				isRequired: true,
				parse: (value) => {
					value = value.trim();

					return (
						allLicenseTypes.find((item) => value.toLowerCase() === item.abbr.toLowerCase())?.abbr ||
						value
					);
				},
				validate: (value) => allLicenseTypes.some((i) => i.abbr === value),
			},
			'briefcase.licenses.licenseNumber': {
				type: 'string',
				isRequired: false,
				validations: [
					{
						regExp: /^[a-zA-Z0-9\-\.]+$/,
						error: 'Only alpha-numeric, -, and . are allowed.',
					},
				],
			},
			'briefcase.licenses.issueDate': {
				type: 'date',
				parse: (value) => midnight(new Date(value), true),
			},
			'briefcase.licenses.expirationDate': {
				type: 'date',
				isRequired: false,
				parse: (value) => midnight(new Date(value), true),
			},
			'briefcase.licenses.isCompact': {
				type: 'bool',
				isRequired: false,
			},
			'briefcase.references': {
				type: 'array',
			},
			'briefcase.references.title': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.references.organization': {
				type: 'string',
			},
			'briefcase.references.firstName': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.references.lastName': {
				type: 'string',
				isRequired: true,
			},
			'briefcase.references.email': {
				type: 'string',
				validations: [
					{
						regExp: EMAIL_REG_EXP,
						error: 'Invalid email address.',
					},
				],
			},
			'briefcase.references.phoneNumber': {
				type: 'string',
				parse: (value) => value.replace(/\D/g, ''),
				minLength: 10,
				maxLength: 10,
			},
			'briefcase.specialties': {
				type: 'array',
				parse: (value) => {
					const result = value.split(',');

					for (let i = 0; i < result.length; i++) {
						result[i] = result[i].trim();
						result[i] =
							allSpecialties.find((item) => result[i].toLowerCase() === item.name.toLowerCase())
								?.name || result[i];
					}

					return result.filter(Boolean);
				},
				validate: (value) => {
					for (const specialty of value) {
						if (!allSpecialties.some((i) => i.name === specialty)) {
							return false;
						}
					}

					return true;
				},
			},
			'briefcase.workExperience.linkedInUrl': {
				type: 'string',
				validations: [
					{
						regExp: URL_REG_EXP,
						error: 'Invalid URL.',
					},
				],
			},
			'briefcase.yearsOfExperience': {
				type: 'string',
				parse: (value) => {
					return parseExperienceLevel(value) || value;
				},
				validate: (value) => ALL_EXPERIENCE_LEVELS.indexOf(value) > -1,
			},
			emailCommunicationEnabled: {
				type: 'bool',
			},
			'jobs.newJobEmail': {
				type: 'number',
				isInt: true,
				minValue: 0,
				maxValue: 3,
			},
			'jobs.newJobSms': {
				type: 'bool',
			},
			'jobs.workCities': {
				type: 'array',
				isRequired: true,
				parse: (value) => {
					const result: WorkCity[] = [];
					const values = value
						.split(';')
						.filter(Boolean)
						.map((i) => i.trim());

					for (const v of values) {
						const cityState = v.split(',');
						const city = cityState?.[0]?.trim() || '';
						const state = cityState?.[1]?.trim() || '';

						result.push({
							city: city,
							state:
								allStates.find(
									(item) =>
										state.toLowerCase() === item.abbr.toLowerCase() ||
										state.toLowerCase() === item.name.toLowerCase()
								)?.abbr || state,
							country: 'US',
						});
					}

					return result;
				},
				validate: (value: WorkCity[]) => {
					for (const v of value) {
						if (!allStates.some((i) => i.abbr === v.state)) {
							return false;
						}
					}

					return true;
				},
			},
			'jobs.workStates': {
				type: 'array',
				parse: (value) => {
					const result: string[] = [];
					const values = value
						.split(',')
						.filter(Boolean)
						.map((i) => i.trim());

					for (const v of values) {
						result.push(
							allStates.find(
								(item) =>
									v.toLowerCase() === item.abbr.toLowerCase() ||
									v.toLowerCase() === item.name.toLowerCase()
							)?.abbr || v
						);
					}

					return result;
				},
				validate: (value) => {
					for (const v of value) {
						if (!allStates.some((i) => i.abbr === v)) {
							return false;
						}
					}

					return true;
				},
			},
			'jobs.workDistance': {
				type: 'number',
				isInt: true,
			},
			languages: {
				type: 'array',
				parse: (value) => {
					return value
						.split(',')
						.filter(Boolean)
						.map((i) => i.trim());
				},
			},
			profession: {
				type: 'string',
			},
			ssn: {
				type: 'string',
				minLength: 4,
				parse: (value) => {
					return value.replace(/\D/g, '').substr(-4);
				},
				validations: [
					{
						regExp: /^[0-9]+$/,
						error: 'Only numeric characters are allowed.',
					},
				],
			},
			timezone: {
				type: 'string',
			},
		},
		validate: (item) => {
			const errors: UnflattenFieldError[] = [];

			if (item.briefcase?.certifications) {
				for (const curCert of item.briefcase.certifications) {
					const cert = allCertifications.find((i) => i.name === curCert.name);

					if (cert) {
						curCert.certifyingBody = cert.certifyingBody;
					}
				}
			}

			if (item.affiliation?.recruiter) {
				if (!item.affiliation.recruiter.phoneNumber && !item.affiliation.recruiter.email) {
					errors.push(
						new UnflattenFieldRequiredError(
							'affiliation.recruiter.email',
							'Phone number or email address is required.'
						)
					);
					errors.push(
						new UnflattenFieldRequiredError(
							'affiliation.recruiter.phoneNumber',
							'Phone number or email address is required.'
						)
					);
				}
			}

			if (item.briefcase?.references?.length) {
				for (let i = 0; i < item.briefcase.references.length; i++) {
					const ref = item.briefcase.references[i];

					if (!ref.phoneNumber && !ref.email) {
						errors.push(
							new UnflattenFieldRequiredError(
								`briefcase.references.${i}.email`,
								'Phone number or email address is required.'
							)
						);
						errors.push(
							new UnflattenFieldRequiredError(
								`briefcase.references.${i}.phoneNumber`,
								'Phone number or email address is required.'
							)
						);
					}
				}
			}

			if (item.briefcase?.licenses?.length) {
				for (let i = 0; i < item.briefcase.licenses.length; i++) {
					const userLicense = item.briefcase.licenses[i];
					const licenseType = allLicenseTypes.find(
						(item) => userLicense.licenseType?.toLowerCase() === item.abbr?.toLowerCase()
					);

					if (
						licenseType.detailsRequired &&
						!(userLicense.licenseNumber && userLicense.licenseBody && userLicense.expirationDate)
					) {
						errors.push(
							new UnflattenFieldRequiredError(
								`briefcase.licenses.${i}.licenseType`,
								`License requires additional fields: License Body, License Number and Expiration Date.`
							)
						);
					}
				}
			}

			return errors;
		},
	};

	let index = 0;

	for await (const row of readable.pipe(csvParser())) {
		index++;

		const curResult: BulkAddResult = { row: index };

		result.push(curResult);

		try {
			const user = unflatten<ProfessionalWithAffiliation>(userConfig, row);
			const affiliation = user.affiliation;

			delete user.affiliation;

			user.signupChannel = 'IMPORT';

			// Look up the work city coordinates.
			if (user.jobs?.workCities) {
				for (let i = 0; i < user.jobs.workCities.length; i++) {
					const workCity = user.jobs.workCities[i];
					const city = await cities.findOne(
						{ city: workCity.city, state: workCity.state, country: workCity.country },
						{ coordinates: 1 }
					);

					if (city) {
						workCity.coordinates = city.coordinates;
					} else {
						user.jobs.workCities.splice(i, 1);
						i--;
					}
				}
			}

			// assign profession based on license type
			if (user.briefcase && user.briefcase.licenses && user.briefcase.licenses.length) {
				// profession is received from first license
				const userLicense = allLicenseTypes.find(
					(item) => item.abbr === user.briefcase.licenses[0].licenseType
				);
				if (userLicense) {
					user.profession = userLicense.profession;
					// filter out licenses that may differ from the main profession (just in case)
					const professionLicenseTypes = allLicenseTypes.filter(
						(licenseType) => licenseType.profession === userLicense.profession
					);
					user.briefcase.licenses = user.briefcase.licenses.filter((license) => {
						return professionLicenseTypes.map((item) => item.abbr).includes(license.licenseType);
					});
				} else {
					// no license, so delete briefcase
					delete user.briefcase;
				}
			} else {
				// no license, so delete briefcase
				delete user.briefcase;
			}

			curResult.user = await add(dataSources, {
				sessionUser,
				user,
				notificationService,
				serverSettings,
				jnpSettings,
				webhookTopicArn: options.webhookTopicArn,
				select: { _id: 1, intId: 1 },
				thirdPartyId: affiliation?.thirdPartyId,
				recruiter: affiliation?.recruiter,
				departmentId: affiliation?.department,
				notes: affiliation?.notes,
				organization,
				isIrpAdd: !!affiliation?.isIrp,
			});
		} catch (err) {
			curResult.errors = [];

			if (err instanceof MultipleErrors) {
				for (const e of err.innerErrors) {
					curResult.errors.push(e);
				}
			} else {
				curResult.errors.push(err);
			}
		}
	}

	return result;
}

function createDataSources(connection: MongoClient, dbName: string): DataSourceCollection {
	const dataSources = new DataSourceCollection();

	dataSources.add(
		new UserRepository(new MongoDbDataDriver(connection, dbName)),
		new UserAuditTrailRepository(new MongoDbDataDriver(connection, dbName)),
		new ProfessionalRepository(new MongoDbDataDriver(connection, dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, dbName)),
		new SettingsRepository({
			useEnvVariables: true,
			driver: new MongoDbDataDriver(connection, dbName),
		}),
		new AppNotificationRepository(new MongoDbDataDriver(connection, dbName)),
		new UrlShortenerRepository(new MongoDbDataDriver(connection, dbName)),
		new CityRepository(new MongoDbDataDriver(connection, dbName)),
		new OrganizationUserRepository(new MongoDbDataDriver(connection, dbName))
	);

	return dataSources;
}

async function getSessionUser(dataSources: DataSourceCollection, userId: string): Promise<User> {
	const users = dataSources.get<UserRepository>(USERS_IDENTIFIER);
	const sessionUser = await users.findById(
		userId,
		Object.assign(
			{
				firstName: 1,
				lastName: 1,
				userType: 1,
				'organization.name': 1,
				'organization.professionals.webhooks.affiliationAdded.httpMethod': 1,
				'organization.professionals.webhooks.affiliationAdded.url': 1,
				'organization.professionals.webhooks.affiliationAdded.headers': 1,
			},
			getOrganizationBrandingSelect('organization')
		)
	);

	if (!sessionUser) {
		throw new UserNotFoundError();
	}

	return sessionUser;
}

async function getOrganization(
	dataSources: DataSourceCollection,
	sessionUser: User,
	organizationId?: string
): Promise<Hospital> {
	const organizations = dataSources.get<HospitalRepository>(HOSPITALS_IDENTIFIER);
	let organization =
		sessionUser && isHospitalUser(sessionUser.userType)
			? (sessionUser as OrganizationUser).organization
			: undefined;

	if (!organization && organizationId) {
		organization = await organizations.findById(
			organizationId,
			Object.assign(
				{
					name: 1,
					'professionals.webhooks': 1,
				},
				getOrganizationBrandingSelect()
			)
		);

		if (!organization) {
			throw new OrganizationNotFoundError();
		}
	}

	if (!organization && sessionUser && isHospitalUser(sessionUser.userType)) {
		throw new UnauthorizedError();
	}

	return organization;
}

async function add(dataSources: DataSourceCollection, options: AddOptions): Promise<Professional> {
	const cities = dataSources.get<CityRepository>(CITIES_IDENTIFIER);
	const departments = dataSources.get<DepartmentRepository>(DEPARTMENTS_IDENTIFIER);
	const professionals = dataSources.get<ProfessionalRepository>(PROFESSIONALS_IDENTIFIER);
	const organizations = dataSources.get<HospitalRepository>(HOSPITALS_IDENTIFIER);
	const urlShortener = dataSources.get<UrlShortenerRepository>(URL_SHORTENER_IDENTIFIER);
	const auditTrail = dataSources.get<UserAuditTrailRepository>(USER_AUDIT_TRAIL_IDENTIFIER);
	const organizationUsers = dataSources.get<OrganizationUserRepository>(
		ORGANIZATION_USERS_IDENTIFIER
	);

	const existingUser = await professionals.findOne(
		{ email: options.user.email },
		{
			firstName: 1,
			lastName: 1,
			userType: 1,
			email: 1,
			phoneNumber: 1,
			profession: 1,
			password: 1,
			activatedAt: 1,
			deactivatedAt: 1,
			isMarketplace: 1,
			verificationToken: 1,
			verificationTokenExpiresAt: 1,
			'affiliations.organization': 1,
			'affiliations.acceptedAt': 1,
			'affiliations.rejectedAt': 1,
		}
	);

	if (existingUser && existingUser.userType !== UserType.Nurse) {
		throw new AccountAlreadyExistsError();
	}

	const branding = await organizations.getBranding2(
		!options.isIrpAdd &&
			existingUser &&
			existingUser.affiliations?.some(
				(i) =>
					!i.rejectedAt &&
					(!options.organization ||
						i.organization._id.toString() !== options.organization._id.toString())
			)
			? null
			: options.organization
	);

	if (existingUser) {
		if (existingUser.deactivatedAt) {
			throw new DeactivatedAccountError();
		}

		// If existing user is signing up with a different profession, throw an error.
		if (
			options.user.profession &&
			existingUser.profession &&
			options.user.profession !== existingUser.profession
		) {
			throw new ProfessionAlreadyAssignedError('The account already has an assigned profession.');
		}

		// If the user already exists and the user is already a global market place user or is already affiliated with the organization we need to throw an error.
		if (
			(!options.organization && existingUser.isMarketplace) ||
			(options.organization &&
				existingUser.affiliations?.some(
					(i) =>
						i.organization._id.toString() === options.organization._id.toString() &&
						(!options.isIrpAdd || i.acceptedAt)
				))
		) {
			let message = 'There is an account associated with this email address.';

			if (!existingUser.activatedAt) {
				message += ' A request for validation has been sent to the email.';

				await options.notificationService.send(
					await getActivationNotification(
						options.serverSettings,
						urlShortener,
						existingUser,
						branding,
						options.isIrpAdd ? options.sessionUser : null,
						options.organization
					)
				);
			}

			throw new AccountAlreadyExistsError(options.isIrpAdd ? message : undefined);
		}
	}

	let department: Department;

	if (options.departmentId && options.sessionUser) {
		if (options.organization) {
			department = await departments.findOne(
				{ _id: departments.toId(options.departmentId), organization: options.organization._id },
				{ _id: 1 }
			);
		}

		if (!department) {
			throw new DepartmentNotFoundError();
		}
	}

	const select = professionals.buildSelect(options.select);

	// If we have an existing user we should add the affiliation or set as a global marketplace user.
	if (existingUser) {
		const verificationToken =
			!existingUser.verificationTokenExpiresAt ||
			existingUser.verificationTokenExpiresAt < new Date()
				? generateVerificationToken()
				: existingUser.verificationToken;

		if (!options.sessionUser) {
			await professionals.update({
				_id: existingUser._id,
				verificationToken,
				verificationTokenExpiresAt: addDays(7),
			});

			await options.notificationService.send(
				await getAddAffiliationNotification(
					options.serverSettings,
					existingUser,
					branding,
					verificationToken,
					options.organization,
					options.external && options.recruiter ? options.recruiter._id.toString() : null
				)
			);

			throw new AddAffiliationRequiredError();
		}

		if (options.organization) {
			await professionals.update({
				_id: existingUser._id,
				verificationToken,
				verificationTokenExpiresAt: addDays(7),
			});

			await professionals.addAffiliation(existingUser, {
				createdBy: options.sessionUser,
				organization: options.organization,
				department,
				thirdPartyId: options.thirdPartyId,
				thirdPartySystems: options.thirdPartySystems,
				isIrp: options.isIrpAdd,
				removeRejection: true,
				recruiter: options.recruiter,
				notes: options.notes,
				phoneNumber: existingUser.phoneNumber
					? existingUser.phoneNumber
					: options.user?.phoneNumber,
			});

			if (
				options.sessionUser?.userType !== UserType.HospitalApi &&
				options.organization.professionals?.webhooks?.affiliationAdded
			) {
				await callWebhook(
					options.webhookTopicArn,
					options.organization.professionals.webhooks.affiliationAdded,
					professionals,
					existingUser._id,
					options.organization
				);
			}
		} else {
			await professionals.update({
				_id: existingUser._id,
				isMarketplace: true,
				verificationToken,
				verificationTokenExpiresAt: addDays(7),
			});
		}

		const notifications: SendOptions[] = [
			existingUser.activatedAt
				? await getWelcomeNotification(urlShortener, existingUser, branding)
				: await getAddAffiliationNotification(
						options.serverSettings,
						existingUser,
						branding,
						verificationToken
				  ),
		];

		// TODO: Implement jackson JNP_ACTIVATION_WELCOME_DAY1 email in the webhook.
		if (
			options.isIrpAdd &&
			options.organization?._id?.toString() === options.jnpSettings.hospitalId &&
			!existingUser.activatedAt
		) {
			notifications.push(
				await getJnpWelcomeNotification(
					options.serverSettings,
					urlShortener,
					existingUser,
					branding,
					verificationToken,
					options.sessionUser
				)
			);
		}

		await options.notificationService.send(notifications);

		throw new AddAffiliationRequiredError(
			'There is an account associated with this email address. A request for validation has been sent to the email.'
		);
	}

	options.user._id = professionals.newId();
	options.user.createdBy = options.sessionUser ? options.sessionUser : { _id: options.user._id };
	options.user.verificationToken = generateVerificationToken();
	options.user.verificationTokenExpiresAt = addDays(7);

	select.verificiationToken = 1;
	select.firstName = 1;
	select.lastName = 1;
	select.email = 1;
	select.phoneNumber = 1;
	select.affiliations = 1;
	select.intId = 1;
	select.briefcase = 1;
	select.profession = 1;

	if (options.user.emailCommunicationEnabled === undefined) {
		options.user.emailCommunicationEnabled = true;
	}

	if (!isEmpty(options.user.address)) {
		if (!options.user.address.country) {
			options.user.address.country = 'US';
		}

		if (!options.user.address.coordinates) {
			const city = await cities.findOne(
				{
					city: options.user.address.city,
					state: options.user.address.state,
					country: options.user.address.country,
				},
				{
					coordinates: 1,
				}
			);

			if (city && city.coordinates) {
				options.user.address.coordinates = city.coordinates;
			}
		}
	}

	if (!isEmpty(options.user?.jobs?.workCities)) {
		for (const item of options.user.jobs.workCities) {
			if (!item.country) {
				item.country = 'US';
			}
		}
	}

	if (isEmptyObject(options.user.briefcase)) {
		delete options.user.briefcase;
	}

	// If there is an organization then we need to setup the affiliation
	if (options.organization) {
		const affiliation: Affiliation = {
			createdAt: new Date(),
			createdBy: options.sessionUser ? options.sessionUser : { _id: options.user._id },
			organization: options.organization,
		};

		options.user.affiliations = [affiliation];

		if (options.sessionUser && options.isIrpAdd) {
			affiliation.acceptedAt = new Date();
			affiliation.acceptedBy = options.sessionUser;
		}

		if (options.thirdPartyId) {
			affiliation.thirdPartyId = options.thirdPartyId;
		}
		if (
			options.sessionUser &&
			options.sessionUser?.userType === UserType.HospitalApi &&
			options.thirdPartySystems
		) {
			affiliation.thirdPartySystems = options.thirdPartySystems;
		}

		if (options.recruiter) {
			if (options.recruiter.email) {
				const recruiterUser = await organizationUsers.findOne(
					{ email: options.recruiter.email },
					{ _id: 1 }
				);
				affiliation.recruiter = recruiterUser ? recruiterUser : options.recruiter;
			} else {
				affiliation.recruiter = options.recruiter;
			}
		}

		if (department) {
			affiliation.department = department;
		}

		if (options.notes) {
			affiliation.notes = [
				{
					createdBy: options.sessionUser,
					createdAt: new Date(),
					text: options.notes,
				},
			];
		}
	} else {
		options.user.isMarketplace = true;
	}

	const result = await professionals.insert(options.user, select);

	await auditTrail.insert({
		action: 'USER_CREATED',
		createdBy: options.user.createdBy,
		data: options.user,
	});

	const notifications: SendOptions[] = [
		await getActivationNotification(
			options.serverSettings,
			urlShortener,
			options.user,
			branding,
			options.isIrpAdd ? options.sessionUser : null
		),
	];

	// TODO: Implement jackson JNP_ACTIVATION_WELCOME_DAY1 email in the webhook.
	if (
		options.isIrpAdd &&
		options.organization?._id?.toString() === options.jnpSettings.hospitalId
	) {
		notifications.push(
			await getJnpWelcomeNotification(
				options.serverSettings,
				urlShortener,
				options.user,
				branding,
				options.user.verificationToken,
				options.sessionUser
			)
		);
	}

	await options.notificationService.send(notifications);

	if (
		options.sessionUser?.userType !== UserType.HospitalApi &&
		options.organization?.professionals?.webhooks?.affiliationAdded
	) {
		await callWebhook(
			options.webhookTopicArn,
			options.organization.professionals.webhooks.affiliationAdded,
			professionals,
			result._id,
			options.organization
		);
	}

	return result;
}

async function getActivationNotification(
	serverSettings: ServerSettings,
	urlShortener: UrlShortenerRepository,
	user: Professional,
	branding: Branding,
	facilityUser?: User,
	organization?: Hospital
): Promise<SendOptions> {
	let qs = `token=${user.verificationToken}`;

	if (organization === null) {
		qs += '&isMarketplace=true';
	} else if (organization) {
		qs += `&organizationId=${organization._id.toString()}`;
	}

	if (facilityUser) {
		const welcomeNotification: SendOptions = {
			template: 'PRN_WELCOME',
			templateArgs: {
				adminName: `${user.firstName} ${user.lastName}`,
				firstName: user.firstName,
				nurseEmail: user.email,
				nursePanelLink: await urlShortener.shortenUrl(
					`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?${qs}`
				),
				facilityUserName: `${facilityUser.firstName} ${facilityUser.lastName}`,
				facilityAddress: branding.facilityAddress,
				facilityLogo: branding.facilityLogo,
				facilityName: branding.facilityName,
			},
		};

		if (user.email) {
			welcomeNotification.email = {
				from: `"${branding.facilityName}" <info@carry.com>`,
				to: user.email,
			};
		}

		let prnSignupLink = await urlShortener.shortenUrl(
			`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?${qs}`
		);

		if (user.phoneNumber && user.jobs?.newJobSms !== false) {
			welcomeNotification.sms = {
				to: user.phoneNumber.toString(),
				message: `${branding.facilityName}: Welcome! Start receiving matching jobs by activating your account profile at ${prnSignupLink}\r\rReply STOP to Unsubscribe.`,
			};
		}

		return welcomeNotification;
	}

	return {
		template: 'VERIFY_EMAIL_NURSE',
		templateArgs: {
			firstName: user.firstName,
			userName: user.email,
			loginUrl: await urlShortener.shortenUrl(`${serverSettings.nursePanelUrl}`),
			link: await urlShortener.shortenUrl(
				`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?${qs}`
			),
			facilityAddress: branding.facilityAddress,
			facilityLogo: branding.facilityLogo,
			facilityName: branding.facilityName,
		},
		email: {
			to: user.email,
		},
	};
}

async function getJnpWelcomeNotification(
	serverSettings: ServerSettings,
	urlShortener: UrlShortenerRepository,
	user: Professional,
	branding: Branding,
	verificationToken: string,
	facilityUser?: User
): Promise<SendOptions> {
	return {
		template: 'JNP_ACTIVATION_WELCOME_DAY1',
		templateArgs: {
			adminName: branding.facilityUserName,
			firstName: user.firstName,
			nurseEmail: user.email,
			loginUrl: await urlShortener.shortenUrl(
				`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?token=${verificationToken}`
			),
			facilityUserName: `${facilityUser.firstName} ${facilityUser.lastName}`,
			facilityAddress: branding.facilityAddress,
			facilityLogo: branding.facilityLogo,
			facilityName: branding.facilityName,
		},
		email: {
			from: `"${branding.facilityName}" <info@carry.com>`,
			to: user.email,
		},
	};
}

async function getWelcomeNotification(
	urlShortener: UrlShortenerRepository,
	user: Professional,
	branding: Branding
): Promise<SendOptions> {
	return {
		template: 'EMAIL_CONFIRMED_NURSE',
		templateArgs: {
			userName: user.email,
			firstName: user.firstName,
			showUserName: 1,
			fbLogin: 0,
			linkedInLogin: 0,
			loginUrl: await urlShortener.shortenUrl(branding.nurseLoginUrl),
			facilityAddress: branding.facilityAddress,
			facilityLogo: branding.facilityLogo,
			facilityName: branding.facilityName,
		},
		email: {
			to: user.email,
		},
	};
}

async function getAddAffiliationNotification(
	serverSettings: ServerSettings,
	user: Professional,
	branding: Branding,
	verificationToken: string,
	organization?: Hospital,
	recruiter?: string
): Promise<SendOptions> {
	let qs = `token=${verificationToken}`;

	if (organization === null) {
		qs += '&isMarketplace=true';
	} else if (organization) {
		qs += `&organizationId=${organization._id.toString()}`;
	}
	if (recruiter) {
		qs += `&recruiterId=${recruiter}`;
	}

	return {
		template: 'ADD_BRIEFCASE_AFFILIATION',
		templateArgs: {
			userName: user.email,
			firstName: user.firstName,
			organization: organization ? organization.name : 'Praos Health',
			facilityAddress: branding.facilityAddress,
			facilityLogo: branding.facilityLogo,
			facilityName: branding.facilityName,
			link: `${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?${qs}`,
		},
		email: {
			to: user.email,
		},
	};
}

async function callWebhook(
	webhookTopicArn: string,
	webhook: Webhook,
	professionals: ProfessionalRepository,
	userId: any,
	organization: Hospital
): Promise<void> {
	try {
		const snsService = new SNS();
		const user = await professionals.findById(
			userId,
			Object.assign(
				{
					'affiliations.thirdPartyId': 1,
					'affiliations.createdAt': 1,
					'affiliations.createdBy.email': 1,
					'affiliations.createdBy.firstName': 1,
					'affiliations.createdBy.lastName': 1,
					'affiliations.createdBy.profilePicUrl': 1,
					'affiliations.createdBy.profilePicThumbUrl': 1,
					'affiliations.acceptedAt': 1,
					'affiliations.acceptedBy.email': 1,
					'affiliations.acceptedBy.firstName': 1,
					'affiliations.acceptedBy.lastName': 1,
					'affiliations.acceptedBy.profilePicUrl': 1,
					'affiliations.acceptedBy.profilePicThumbUrl': 1,
					'affiliations.organization._id': 1,
					'affiliations.organization.name': 1,
					'affiliations.recruiter.firstName': 1,
					'affiliations.recruiter.lastName': 1,
					'affiliations.recruiter.email': 1,
					'affiliations.recruiter.phone': 1,
				},
				professionals.buildShareSelect('full')
			)
		);

		const jsonUser = toJson(user);
		const jsonAffiliation = jsonUser.affiliations?.find(
			(i) => i.organization._id.toString() === organization._id.toString()
		);

		delete jsonUser.affiliations;

		await snsService
			.publish({
				Message: JSON.stringify({
					httpMethod: webhook.httpMethod,
					url: webhook.url,
					headers: webhook.headers,
					body: {
						action: 'affiliationAdded',
						user: jsonUser,
						affiliation: jsonAffiliation,
					},
				}),
				TopicArn: webhookTopicArn,
			})
			.promise();
	} catch (err) {
		console.log(err);
	}
}

async function sendJobBoardRecruiterEmail(options: ExecuteOptions) {
	const APPLY_EMAIL_TEMPLATE = 'JOBBOARD_APPLY_INBOUNDLEAD';
	const { item, jobId, organizationId, recruiter } = options;

	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSources = createDataSources(connection, options.db.dbName);
	dataSources.add(new JobRepository(new MongoDbDataDriver(connection, options.db.dbName)));

	const settings = dataSources.get<SettingsRepository>(SETTINGS_IDENTIFIER);
	const appNotifications = dataSources.get<AppNotificationRepository>(NOTIFICATIONS_IDENTIFIER);
	const organizations = dataSources.get<HospitalRepository>(HOSPITALS_IDENTIFIER);
	const jobs = dataSources.get<JobRepository>(JOBS_IDENTIFIER);
	const users = dataSources.get<UserRepository>(USERS_IDENTIFIER);

	const notificationSettings = await settings.getSettings<NotificationSettings>(
		NOTIFICATION_SETTINGS
	);

	const notificationService = new NotificationService({
		appNotifications: appNotifications,
		notifyUrl: notificationSettings.notifyUrl,
		registerUrl: notificationSettings.registerUrl,
		unregisterUrl: notificationSettings.unregisterUrl,
		authToken: options.authToken,
	});

	const job = await jobs.findOne({ _id: jobs.toId(jobId) });
	const organization = await getOrganization(dataSources, null, organizationId);
	const branding = await organizations.getBranding2(organization);
	let recruiterEmail = '';
	if (recruiter) {
		recruiterEmail =
			(await users.findOne({ _id: users.toId(recruiter) }, { email: 1 })).email || '';
	} else {
		recruiterEmail = organization.generalContactInfo?.email || '';
	}

	if (recruiterEmail) {
		const notification: SendOptions = {
			template: APPLY_EMAIL_TEMPLATE,
			templateArgs: {
				jobId: job.intId,
				jobTitle: job.title,
				firstName: item.firstName,
				lastName: item.lastName,
				profession: item.profession,
				email: item.email,
				phone: formatPhoneNumber(item.phoneNumber) || '',
				license:
					item.briefcase && item.briefcase.licenses && item.briefcase.licenses.length
						? item.briefcase.licenses[0].licenseType
						: undefined,
				specialty:
					item.briefcase && item.briefcase.specialties && item.briefcase.specialties.length
						? item.briefcase.specialties.join(', ')
						: 'None',
				states: item.jobs && item.jobs.workStates ? item.jobs.workStates.join(', ') : undefined,
				cities:
					item.jobs && item.jobs.workCities
						? item.jobs.workCities.map((c) => c.city).join(', ')
						: undefined,
				facilityAddress: branding.facilityAddress,
				facilityLogo: branding.facilityLogo,
				facilityName: branding.facilityName,
				color: organization?.facility?.color ? `#${organization.facility.color}` : '#613794',
			},
			email: {
				from: `"${branding.facilityName}" <info@carry.com>`,
				to: recruiterEmail,
			},
		};
		await notificationService.send(notification);
	}
}
