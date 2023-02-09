import { UnauthorizedError } from '@carry/core/errors';
import { addDays } from '@carry/core/utilities/date';
import { applyIfDefined, getPathValues, isEmpty, isObject, PathValue, registerJsonFactory, toJson } from '@carry/core/utilities/object';
import { DataSourceCollection } from '@carry/data-access/data-source-collection';
import { getConnection } from '@carry/data-access/mongodb/connection';
import { MongoDbDataDriver } from '@carry/data-access/mongodb/data-driver';
import { SettingsRepository } from '@carry/data-access/settings-repository';
import { UploadedFileRepository } from '@carry/files/uploaded-file/uploaded-file-repository';
import { addNurse } from '@carry/nursys-client';
import { CityRepository } from '@carry/praos/city/city-repository';
import { DepartmentRepository } from '@carry/praos/department/department-repository';
import { EmailAlreadyInUseError, ProfessionAlreadyAssignedError, UserNotFoundError } from '@carry/praos/errors';
import { buildFileSelect, FileField, setFileValues } from '@carry/praos/file/file-field';
import { UploadedFile } from '@carry/praos/file/uploaded-file';
import { getOrganizationBrandingSelect, HospitalRepository } from '@carry/praos/hospital/hospital-repository';
import { LicenseBodyRepository } from '@carry/praos/license-body/license-body-repository';
import { LicenseTypeRepository } from '@carry/praos/license-type/license-type-repository';
import { Address } from '@carry/praos/location/address';
import { AppNotificationRepository } from '@carry/praos/notification/app-notification-repository';
import { NotificationService, SendOptions } from '@carry/praos/notification/notification-service';
import { NOTIFICATION_SETTINGS, NotificationSettings } from '@carry/praos/notification/notification-settings';
import { NursysCredentialsRepository } from '@carry/praos/nursys/nursys-credentials-repository';
import { NURSYS_SETTINGS, NursysSettings } from '@carry/praos/nursys/nursys-settings';
import { ActivityWork } from '@carry/praos/professional/activity-work';
import { AdditionalCertification } from '@carry/praos/professional/additional-certification';
import { AdditionalDocument } from '@carry/praos/professional/additional-document';
import { BriefcaseField, BriefcaseItem, fieldToPath } from '@carry/praos/professional/briefcase';
import { Certification } from '@carry/praos/professional/certification';
import { Competency } from '@carry/praos/professional/competency';
import { DriversLicense } from '@carry/praos/professional/drivers-license';
import { ContinuingEducation, Education, EducationDocument } from '@carry/praos/professional/education';
import { EmergencyContact } from '@carry/praos/professional/emergency-contact';
import { Facility } from '@carry/praos/professional/facility';
import { HealthDocument } from '@carry/praos/professional/health-document';
import { WorkCity } from '@carry/praos/professional/job-info';
import { LiabilityInsurance } from '@carry/praos/professional/liability-insurance';
import { License } from '@carry/praos/professional/license';
import { OrganizationMembership } from '@carry/praos/professional/organization-membership';
import { hasAccess, Professional } from '@carry/praos/professional/professional';
import { ProfessionalRepository } from '@carry/praos/professional/professional-repository';
import { Reference } from '@carry/praos/professional/reference';
import { Share } from '@carry/praos/professional/share';
import { VehicleInsurance } from '@carry/praos/professional/vehicle-insurance';
import { WorkExperience } from '@carry/praos/professional/work-experience';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { SERVER_SETTINGS, ServerSettings } from '@carry/praos/settings/server-settings';
import { S3_SETTINGS, S3Settings } from '@carry/praos/system/s3-settings';
import { UserAuditTrailRepository } from '@carry/praos/user-audit-trail/user-audit-trail-repository';
import { Gender, generateVerificationToken, getFileName, User } from '@carry/praos/user/user';
import { getUserBrandingSelect, UserRepository } from '@carry/praos/user/user-repository';
import { isAdminUser, UserType } from '@carry/praos/user/user-type';
import { UrlShortenerRepository } from '@carry/url-shortener/url-shortener-repository';
import { S3, SNS } from 'aws-sdk';
import * as crypto from 'crypto';
import { ExternalSource } from '@carry/praos/external-source/externalSource';

const IRP_STATUSES = ['Available', 'Placed', 'Placement', 'Talent Converted'];

export type UpdateOptions = {
	authToken: string,
	db: {
		uri: string,
		dbName: string,
		poolSize: number
	},
	webhookTopicArn: string,
	session?: JwtSession,
	userId: string,
	select: any,
	item: UpdateItem,
	externalSource?: ExternalSource
};

type UpdateItem = {
	currentStep?: number,
	firstName?: string,
	lastName?: string,
	dateOfBirth?: Date,
	profilePicUrl?: null,
	gender?: Gender,
	email?: string,
	phoneNumber?: string,
	address?: Address,
	ssn?: string,
	languages?: string[],
	emergencyContact?: EmergencyContact,
	emailCommunicationEnabled?: boolean,
	profession?: string,
	jobs?: {
		workCities?: WorkCity[],
		workStates?: string[],
		workDistance?: number
	},
	briefcase?: {
		currentStep?: number,
		activityWork?: ActivityWork[],
		additionalCertifications?: AdditionalCertification[],
		additionalDocuments?: AdditionalDocument[],
		certifications?: Certification[],
		competencies?: Competency[],
		consentedAt?: boolean,
		continuingEducation?: ContinuingEducation[],
		driversLicense?: DriversLicense,
		education?: Education[],
		educationDocuments?: EducationDocument[],
		educationLevel?: string,
		ehrSkills?: string[],
		facilities?: Facility[],
		healthDocuments?: HealthDocument[],
		liabilityInsurance?: LiabilityInsurance,
		licenses?: License[],
		nursys?: { isEnabled?: boolean },
		organizationMembership?: OrganizationMembership[],
		references?: Reference[],
		specialties?: string[],
		vehicleInsurance?: VehicleInsurance,
		w9?: string,
		workExperience?: WorkExperience,
		yearsOfExperience?: string
	}
}

export type UpdateItemOptions = {
	authToken: string,
	db: {
		uri: string,
		dbName: string,
		poolSize: number
	},
	webhookTopicArn: string,
	session?: JwtSession,
	userId: string,
	field: BriefcaseField,
	add: boolean,
	item: BriefcaseItem
}

export type DeleteItemOptions = {
	db: {
		uri: string,
		dbName: string,
		poolSize: number
	},
	webhookTopicArn: string,
	session?: JwtSession,
	userId: string,
	field: BriefcaseField,
	itemId: any
}

export type UserFileValue = {
	file: FileField,
	pathValue: PathValue,
	fileUpload?: UploadedFile
}

export type UpdatedFiles = {
	deleteKeys: string[],
	updatedItems: { url: string, path: string, item: any }[]
}

export type ExternalExecuteOptions = {
	webhookTopicArn: string,
	updateAffiliationTopicArn: string,
	authToken: string,
	db: {
		uri: string,
		dbName: string,
		poolSize: number
	},
	organizationId: string
}

export async function updateProfessional(options: UpdateOptions): Promise<Professional> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSources = new DataSourceCollection();
	const [users, professionals, settings, urlShortener, appNotifications, cities, organizations, auditTrail, uploadedFiles] = dataSources.add(
		new UserRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new ProfessionalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new SettingsRepository({ driver: new MongoDbDataDriver(connection, options.db.dbName), useEnvVariables: true }),
		new UrlShortenerRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new AppNotificationRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new CityRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new UserAuditTrailRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new UploadedFileRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, options.db.dbName))
	);

	let [s3Settings, serverSettings, notificationSettings, sessionUser, user] = await Promise.all([
		settings.getSettings<S3Settings>(S3_SETTINGS),
		settings.getSettings<ServerSettings>(SERVER_SETTINGS),
		settings.getSettings<NotificationSettings>(NOTIFICATION_SETTINGS),
		(options.session.userId === options.userId) ? undefined : users.findById(
			options.session.userId,
			{
				userType: 1,
				organization: 1
			}
		),
		professionals.findById(
			options.userId,
			Object.assign(
				{
					'intId': 1,
					'firstName': 1,
					'lastName': 1,
					'userType': 1,
					'email': 1,
					'phoneNumber': 1,
					'activatedAt': 1,
					'verificationToken': 1,
					'verificationTokenExpiresAt': 1,
					'profilePicUrl': 1,
					'profession': 1,
					'address.state': 1,
					'briefcase.completedAt': 1,
					'briefcase.currentStep': 1,
					'briefcase.additionalCertifications.id': 1,
					'briefcase.additionalCertifications.thirdPartySystems': 1,
					'briefcase.education.id': 1,
					'briefcase.education.thirdPartySystems': 1,
					'briefcase.facilities.id': 1,
					'briefcase.facilities.thirdPartySystems': 1,
					'briefcase.references.id': 1,
					'briefcase.references.thirdPartySystems': 1,
					'briefcase.nursys.verificationText': 1,
					'affiliations.rejectedAt': 1,
					'affiliations.thirdPartySystems': 1,
					'affiliations.organization.professionals.webhooks.updated.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.updated.url': 1,
					'affiliations.organization.professionals.webhooks.updated.headers': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.url': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.headers': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.url': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.headers': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.url': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.headers': 1,
					'affiliations.recruiter.firstName': 1,
					'affiliations.recruiter.lastName': 1,
					'affiliations.recruiter.email': 1,
					'affiliations.recruiter.phoneNumber': 1
				},
				buildFileSelect(professionals.files, options.item as any),
				getUserBrandingSelect(),
				getOrganizationBrandingSelect('affiliations.organization')
			)
		)
	]);

	if (options.session.userId === options.userId) {
		sessionUser = user;
	}

	if (!sessionUser || !user) {
		throw new UserNotFoundError();
	}

	if (!hasAccess(sessionUser, user)) {
		throw new UnauthorizedError();
	}

	if (options.item.email && options.item.email != user.email && await users.findOne({ email: options.item.email }, { _id: 1 })) {
		throw new EmailAlreadyInUseError();
	}

	if (checkProfession(user.profession, options.item.profession)) {
		throw new ProfessionAlreadyAssignedError();
	}

	const s3 = new S3({
		region: s3Settings.region,
		secretAccessKey: s3Settings.s3SecretAccessKey,
		accessKeyId: s3Settings.s3AccessKeyId
	});

	const notificationService = new NotificationService({
		appNotifications: appNotifications,
		notifyUrl: notificationSettings.notifyUrl,
		registerUrl: notificationSettings.registerUrl,
		unregisterUrl: notificationSettings.unregisterUrl,
		authToken: options.authToken
	});

	let professional = applyIfDefined<Professional>(
		{
			_id: options.userId
		},
		options.item
	);
	setThirdPartySystems(user, professional, sessionUser);

	const [branding, updatedFiles] = await Promise.all([
		professionals.getBranding(user),
		updateFiles(professionals, uploadedFiles, s3, s3Settings, user, professional)
	]);

	const updateSelect = professionals.buildSelect(buildUpdateSelect(options.item));
	const select = professionals.buildSelect(options.select);
	let verificationToken = user.verificationToken;

	if (professional.jobs && (professional.jobs.workStates == null && professional.jobs.workStates?.length === 0)) {
		const state = professional.address?.state || user.address?.state;

		if (state) {
			professional.jobs.workStates = [state];
		}
	}

	if (professional.briefcase) {
		if (professional.briefcase.consentedAt) {
			professional.briefcase.consentedAt = new Date();
		} else {
			delete professional.briefcase.consentedAt;
		}

		if (isAdminUser(options.session.userType) && professional.briefcase.nursys?.isEnabled !== undefined) {
			if (user.briefcase?.nursys?.verificationText) {
				professional.briefcase.nursys.verificationText = user.briefcase.nursys.verificationText;
			}
		} else {
			delete professional.briefcase.nursys;
		}
	}

	if (professional.email && professional.email != user.email) {
		professional.emailVerifiedAt = null;
		professional.verificationToken = verificationToken = (!user.verificationTokenExpiresAt || user.verificationTokenExpiresAt < new Date() || !user.activatedAt) ? generateVerificationToken() : user.verificationToken;
		professional.verificationTokenExpiresAt = addDays(7);
	}

	if (!isEmpty(professional.address)) {
		if (!professional.address.country) {
			professional.address.country = 'US';
		}

		const city = await cities.findOne(
			{
				city: professional.address.city,
				state: professional.address.state,
				country: professional.address.country
			},
			{
				coordinates: 1
			}
		);

		if (city && city.coordinates) {
			professional.address.coordinates = city.coordinates;
		}
	}

	if (!isEmpty(professional?.jobs?.workCities)) {
		professional.jobs.workCities = (await cities.find(
			{
				$or: professional.jobs.workCities.map(function (i) { return { city: i.city, state: i.state, country: (i.country || 'US') } })
			},
			{
				"city": 1,
				"state": 1,
				"country": 1,
				"coordinates": 1,
				"population": 1
			}
		).toArray()).map(function (i) { return { city: i.city, state: i.state, country: i.country, coordinates: i.coordinates, population: i.population } });
	}

	if (professional.profilePicUrl === null) {
		const work: Promise<any>[] = [];
		const s3 = new S3({
			region: s3Settings.region,
			secretAccessKey: s3Settings.s3SecretAccessKey,
			accessKeyId: s3Settings.s3AccessKeyId
		});

		if (user.profilePicUrl && user.profilePicUrl.startsWith(s3Settings.s3Url)) {
			work.push(
				s3.deleteObject(
					{
						Bucket: s3Settings.s3Bucket,
						Key: user.profilePicUrl.substring(s3Settings.s3Url.length)
					}
				).promise()
			);
		}

		if (user.profilePicThumbUrl && user.profilePicThumbUrl.startsWith(s3Settings.s3Url)) {
			work.push(
				s3.deleteObject(
					{
						Bucket: s3Settings.s3Bucket,
						Key: user.profilePicThumbUrl.substring(s3Settings.s3Url.length)
					}
				).promise()
			);
		}

		professional.profilePicUrl = null;
		professional.profilePicThumbUrl = null;

		await Promise.all(work);
	}

	Object.assign(select,
		{
			phoneNumber: 1, email: 1, firstName: 1,
			lastName: 1, affiliations: 1,
			intId: 1, address: 1, 'jobs.workCities': 1, profession: 1,
			'briefcase.education': 1, 'briefcase.references': 1, 'briefcase.facilities': 1,
			'briefcase.educationLevel': 1, 'briefcase.yearsOfExperience': 1, 'briefcase.workExperience': 1,
			'briefcase.additionalDocuments': 1, 'briefcase.healthDocuments': 1, 'briefcase.educationDocuments': 1
		}
	);

	const result = await professionals.update(professional, select);

	await auditTrail.insert({ action: 'USER_UPDATED', createdBy: sessionUser, user: professional, data: professional });

	if (!user.briefcase?.completedAt) {
		await sendCompletedNotifications(professionals, organizations, notificationService, urlShortener, serverSettings, user);
	}

	if (options.item.email && options.item.email != user.email) {
		if (user.activatedAt) {
			await notificationService.send({
				template: 'EMAIL_CHANGE_CONFIRMATION',
				templateArgs: {
					firstName: options.item.firstName || user.firstName,
					userName: options.item.email,
					loginUrl: await urlShortener.shortenUrl(`${branding.nurseLoginUrl}`),
					link: await urlShortener.shortenUrl(`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?token=${verificationToken}`),
					facilityAddress: branding.facilityAddress,
					facilityLogo: branding.facilityLogo,
					facilityName: branding.facilityName
				},
				email: {
					to: options.item.email
				}
			});
		} else if (branding.isPrn) {
			await notificationService.send({
				template: 'PRN_WELCOME',
				templateArgs: {
					adminName: `${(options.item.firstName || user.firstName)} ${(options.item.lastName || user.lastName)}`,
					firstName: (options.item.firstName || user.firstName),
					nurseEmail: options.item.email,
					nursePanelLink: await urlShortener.shortenUrl(`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?token=${verificationToken}`),
					facilityUserName: branding.facilityUserName,
					facilityAddress: branding.facilityAddress,
					facilityLogo: branding.facilityLogo,
					facilityName: branding.facilityName
				},
				email: {
					from: `"${branding.facilityName}" <info@carry.com>`,
					to: options.item.email
				}
			});
		} else {
			await notificationService.send({
				template: 'VERIFY_EMAIL_NURSE',
				templateArgs: {
					firstName: (options.item.firstName || user.firstName),
					userName: options.item.email,
					loginUrl: await urlShortener.shortenUrl(`${serverSettings.nursePanelUrl}`),
					link: await urlShortener.shortenUrl(`${serverSettings.nursePanelUrl}#/verify/${user._id.toString()}?token=${verificationToken}`),
					facilityAddress: branding.facilityAddress,
					facilityLogo: branding.facilityLogo,
					facilityName: branding.facilityName
				},
				email: {
					to: options.item.email
				}
			});
		}
	}

	if ((user.briefcase?.currentStep || 0) < 2 && options.item.briefcase?.currentStep >= 2 && (options.item.phoneNumber || user.phoneNumber)) {
		await notificationService.send({
			sms: {
				to: options.item.phoneNumber || user.phoneNumber,
				message: `Hi, I am Nicole, your ${branding.facilityName} / Praos app liaison. Please download our mobile app iOS Click https://l.carry.com/ios or Android Click https://l.carry.com/android to get matched to real-time jobs and to contact your recruiter. Don’t forget to update your BLS/Certs, skills checklist, resume, and reference. Need help with doc uploads? Send them to support@carry.com or text them to 682-803-0607. Have a great day!`
			}
		});
	}

	for (const key of updatedFiles.deleteKeys) {
		await s3.deleteObject(
			{
				Bucket: s3Settings.s3Bucket,
				Key: key
			}
		).promise();
	}

	if (options.session.userType !== UserType.HospitalApi && user.affiliations?.some(i => !i.rejectedAt && i.organization.professionals?.webhooks?.updated)) {
		await callUpdatedWebhook(options.webhookTopicArn, professionals, user, updateSelect);
	}

	if (options.session.userType !== UserType.HospitalApi && user.affiliations?.some(i => !i.rejectedAt && i.organization.professionals?.webhooks?.fileUploaded)) {
		for (const item of updatedFiles.updatedItems) {
			await callFileUploadedWebhook(options.webhookTopicArn, user, item.path, item.url, item.item);
		}
	}

	return result;
}

function checkProfession(internalProfession?: string, externalProfession?: string): boolean {
	if (internalProfession && externalProfession && (internalProfession.toUpperCase() !== externalProfession.toUpperCase())) {
		return true;
	}
	return false;
}

// reassign thirdPartySystems to new object
function setThirdPartySystems(dbProfessional: Professional, newProfessional: Professional, session: User) {
	if (session?.userType !== UserType.HospitalApi) {
		if (newProfessional?.briefcase?.education) newProfessional.briefcase.education.map(education => delete education.thirdPartySystems)
		if (newProfessional?.briefcase?.references) newProfessional.briefcase.references.map(reference => delete reference.thirdPartySystems)
		if (newProfessional?.briefcase?.facilities) newProfessional.briefcase.facilities.map(facility => delete facility.thirdPartySystems)
	}

	if (dbProfessional?.briefcase?.additionalCertifications && newProfessional?.briefcase?.additionalCertifications) {
		for (const dbAdditionalCert of dbProfessional.briefcase.additionalCertifications) {
			let foundIndex = newProfessional.briefcase.additionalCertifications.findIndex(cert => String(cert.id) === String(dbAdditionalCert.id));
			if (foundIndex >= 0 && dbAdditionalCert.thirdPartySystems) {
				newProfessional.briefcase.additionalCertifications[foundIndex].thirdPartySystems = dbAdditionalCert.thirdPartySystems;
			}
		}
	}

	if (dbProfessional?.briefcase?.education && newProfessional?.briefcase?.education) {
		for (const dbEducation of dbProfessional.briefcase.education) {
			let foundIndex = newProfessional.briefcase.education.findIndex(ed => String(ed.id) === String(dbEducation.id));
			if (foundIndex >= 0 && dbEducation.thirdPartySystems) {
				newProfessional.briefcase.education[foundIndex].thirdPartySystems = dbEducation.thirdPartySystems;
			}
		}
	}

	if (dbProfessional?.briefcase?.references && newProfessional?.briefcase?.references) {
		for (const dbReference of dbProfessional.briefcase.references) {
			let foundIndex = newProfessional.briefcase.references.findIndex(ref => String(ref.id) === String(dbReference.id));
			if (foundIndex >= 0 && dbReference.thirdPartySystems) {
				newProfessional.briefcase.references[foundIndex].thirdPartySystems = dbReference.thirdPartySystems;
			}
		}
	}

	if (dbProfessional?.briefcase?.facilities && newProfessional?.briefcase?.facilities) {
		for (const dbFacility of dbProfessional.briefcase.facilities) {
			let foundIndex = newProfessional.briefcase.facilities.findIndex(fac => String(fac.id) === String(dbFacility.id));
			if (foundIndex >= 0 && dbFacility.thirdPartySystems) {
				newProfessional.briefcase.facilities[foundIndex].thirdPartySystems = dbFacility.thirdPartySystems;
			}
		}
	}
}

export async function updateItem(options: UpdateItemOptions): Promise<BriefcaseItem> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSources = new DataSourceCollection();
	const [users, professionals, settings, appNotifications, urlShortener, organizations, auditTrail, uploadedFiles] = dataSources.add(
		new UserRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new ProfessionalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new SettingsRepository({ driver: new MongoDbDataDriver(connection, options.db.dbName), useEnvVariables: true }),
		new AppNotificationRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new UrlShortenerRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new UserAuditTrailRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new UploadedFileRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, options.db.dbName))
	);
	const fieldPath = fieldToPath(options.field);
	const fieldName = fieldPath.substring(10);
	const userUpdate: Professional = { briefcase: {} };
	let suspend = false;
	let disableNursys = false;
	let verificationText: string;

	userUpdate.briefcase[fieldName] = [options.item];

	let [s3Settings, serverSettings, notificationSettings, sessionUser, user] = await Promise.all([
		settings.getSettings<S3Settings>(S3_SETTINGS),
		settings.getSettings<ServerSettings>(SERVER_SETTINGS),
		settings.getSettings<NotificationSettings>(NOTIFICATION_SETTINGS),
		(options.session.userId === options.userId) ? undefined : users.findById(
			options.session.userId,
			{
				userType: 1,
				organization: 1
			}
		),
		professionals.findById(
			options.userId,
			Object.assign(
				{
					'intId': 1,
					'userType': 1,
					'firstName': 1,
					'lastName': 1,
					'email': 1,
					'phoneNumber': 1,
					'profession': 1,
					'address.address1': 1,
					'address.address2': 1,
					'address.city': 1,
					'address.zip': 1,
					'affiliations.organization': 1,
					'affiliations.rejectedAt': 1,
					'affiliations.thirdPartySystems': 1,
					'affiliations.organization.professionals.webhooks.updated.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.updated.url': 1,
					'affiliations.organization.professionals.webhooks.updated.headers': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.url': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.headers': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.url': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.headers': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.url': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.headers': 1,
					'affiliations.recruiter.firstName': 1,
					'affiliations.recruiter.lastName': 1,
					'affiliations.recruiter.email': 1,
					'affiliations.recruiter.phoneNumber': 1,
					'briefcase.completedAt': 1
				},
				options.add ? {} : buildFileSelect(professionals.files, userUpdate)
			)
		)
	]);

	if (options.session.userId === options.userId) {
		sessionUser = user;
	}

	if (!sessionUser || !user) {
		throw new UserNotFoundError();
	}

	if (!hasAccess(sessionUser, user)) {
		throw new UnauthorizedError();
	}

	const s3 = new S3({
		region: s3Settings.region,
		secretAccessKey: s3Settings.s3SecretAccessKey,
		accessKeyId: s3Settings.s3AccessKeyId
	});

	const notificationService = new NotificationService({
		appNotifications: appNotifications,
		notifyUrl: notificationSettings.notifyUrl,
		registerUrl: notificationSettings.registerUrl,
		unregisterUrl: notificationSettings.unregisterUrl,
		authToken: options.authToken
	});

	const updatedFiles = await updateFiles(professionals, uploadedFiles, s3, s3Settings, user, userUpdate);
	const item = userUpdate.briefcase[fieldName][0];

	if (options.field === BriefcaseField.Licenses) {
		const nursysSettings = await settings.getSettings<NursysSettings>(NURSYS_SETTINGS);
		const license: License = item;

		if ((license.ssn && license.dateOfBirth !== undefined) || license.manualOverride) {
			if (nursysSettings.ignoreEmailPattern.exec(user.email)) {
				license.verificationText = 'Verified manually';
			} else {
				const licenseBodies = dataSources.add(
					new LicenseBodyRepository(new MongoDbDataDriver(connection, options.db.dbName))
				);

				const licenseBody = await licenseBodies.findOne(
					{ name: license.licenseBody },
					{
						useNursys: 1,
						state: 1,
						licenseFormats: 1
					}
				);

				if (nursysSettings.isEnabled && !license.manualOverride) {
					const [nursysCredentials, licenseTypes] = dataSources.add(
						new NursysCredentialsRepository(new MongoDbDataDriver(connection, options.db.dbName)),
						new LicenseTypeRepository(new MongoDbDataDriver(connection, options.db.dbName))
					);

					const [credentials, licenseType] = await Promise.all([
						nursysCredentials.getCredentials(),
						licenseTypes.findOne(
							{
								abbr: license.licenseType
							},
							{
								useEVerify: 1
							}
						)
					]);

					if (licenseType?.useEVerify && licenseBody?.useNursys) {
						try {
							await addNurse(
								{
									username: credentials.username,
									password: credentials.password
								},
								{
									licenseNumber: license.licenseNumber,
									licenseType: license.licenseType,
									licenseState: licenseBody.state,
									licenseFormats: licenseBody.licenseFormats,
									email: user.email,
									// phoneNumber: user.phoneNumber,
									address1: user.address?.address1,
									address2: user.address?.address2,
									city: user.address?.city,
									// The address should really be the address of the hospital. We must pass the license state or Nursys will fail
									state: licenseBody.state,
									zip: user.address?.zip,
									ssn: license.ssn,
									birthYear: new Date(license.dateOfBirth).getFullYear()
								}
							);

							license.verifiedAt = new Date();
							license.verificationText = 'UNENCUMBERED';

							if (serverSettings.env === 'live') {
								await notificationService.send({
									template: 'NURSYS_SUCCESS_VERIFY_LICENSE',
									templateArgs: {
										email: user.email,
										licenseState: licenseBody.state,
										licenseType: license.licenseType,
										licenseNumber: license.licenseNumber,
										nursysResponse: license.verificationText
									},
									email: {
										to: 'support@carry.com'
									}
								});
							}
							if (serverSettings.env === 'staging') {
								await notificationService.send({
									template: 'NURSYS_SUCCESS_VERIFY_LICENSE',
									templateArgs: {
										email: user.email,
										licenseState: licenseBody.state,
										licenseType: license.licenseType,
										licenseNumber: license.licenseNumber,
										nursysResponse: license.verificationText
									},
									email: {
										to: nursysSettings.notificationEmail
									}
								});
							}
						} catch (err) {
							const errors = err.innerErrors || [err.message];
							const errMessage = [];
							const text = []

							for (const innerErr of errors) {
								let found = false;
								let msg = typeof innerErr === 'string' ? innerErr : innerErr.message;

								if (nursysSettings.errorPatterns) {
									for (const regEx of nursysSettings.errorPatterns) {
										if (regEx.test(msg)) {
											found = true;
											break;
										}
									}
								}

								errMessage.push(msg);
								text.push(found ? msg : nursysSettings.error);
							}

							// suspend and disable nursys daily check if something went wrong with license check
							suspend = true;
							disableNursys = true;
							verificationText = text.join('\r\n');
							license.verificationText = errMessage.join('\r\n');

							await notificationService.send({
								template: 'NURSYS_FAILURE_VERIFY_LICENSE',
								templateArgs: {
									env: serverSettings.env,
									errorMessage: [`${user.email} ${license.licenseNumber} ${licenseBody.state} ${license.licenseType}`].concat(errMessage).join('\r\n')
								},
								email: {
									to: nursysSettings.notificationEmail
								}
							});
						}
					} else {
						if (serverSettings.env === 'live') {
							await notificationService.send({
								template: 'NURSYS_MANUAL_VERIFICATION_REQUIRED',
								templateArgs: {
									email: user.email,
									licenseState: licenseBody.state,
									licenseType: license.licenseType,
									licenseNumber: license.licenseNumber
								},
								email: {
									to: 'support@carry.com'
								}
							});
						}
						if (serverSettings.env === 'staging') {
							await notificationService.send({
								template: 'NURSYS_MANUAL_VERIFICATION_REQUIRED',
								templateArgs: {
									email: user.email,
									licenseState: licenseBody.state,
									licenseType: license.licenseType,
									licenseNumber: license.licenseNumber
								},
								email: {
									to: nursysSettings.notificationEmail
								}
							});
						}

						license.verificationText = 'Manual Verification Required';
						verificationText = 'Your license is pending verification with the issuing Board. Please continue to fill out your Professional Briefcase.';
						disableNursys = true; // disable nursys daily check status for non nursys licenses
					}
				} else {
					if (serverSettings.env === 'live') {
						await notificationService.send({
							template: 'NURSYS_MANUAL_VERIFICATION_REQUIRED',
							templateArgs: {
								email: user.email,
								licenseState: licenseBody.state,
								licenseType: license.licenseType,
								licenseNumber: license.licenseNumber
							},
							email: {
								to: 'support@carry.com'
							}
						});
					}
					if (serverSettings.env === 'staging') {
						await notificationService.send({
							template: 'NURSYS_MANUAL_VERIFICATION_REQUIRED',
							templateArgs: {
								email: user.email,
								licenseState: licenseBody.state,
								licenseType: license.licenseType,
								licenseNumber: license.licenseNumber
							},
							email: {
								to: nursysSettings.notificationEmail
							}
						});
					}

					license.verificationText = 'Manual Verification Required';
					verificationText = license.manualOverride ? 'Verified manually' : 'Your license is pending verification with the issuing Board. Please continue to fill out your Professional Briefcase.';
					suspend = !license.manualOverride;
				}
			}
		}
	}

	let result: BriefcaseItem;

	if (options.add) {
		result = await professionals.addBriefcaseItem(user, options.field, item, disableNursys);

		if (item.id) {
			await uploadedFiles.deleteMany({ objectId: uploadedFiles.toId(item.id) });
		}

		await auditTrail.insert({ action: 'USER_ITEM_ADDED', createdBy: sessionUser, user: user, data: { field: options.field, item } });
	} else {
		if (options.field === BriefcaseField.Licenses) {
			const professionaWithLicense = await professionals.findOne({
				'briefcase.licenses.id': professionals.toId(item.id)
			},
				{
					'briefcase.licenses.thirdPartySystems': 1,
					'briefcase.licenses.id': 1
				});
			const lic = professionaWithLicense?.briefcase?.licenses.find(license => license?.id.toString() === String(item.id));
			if (lic && lic.thirdPartySystems) item['thirdPartySystems'] = lic.thirdPartySystems;
		}
		result = await professionals.updateBriefcaseItem(user, options.field, item, disableNursys);

		await auditTrail.insert({ action: 'USER_ITEM_UPDATED', createdBy: sessionUser, user: user, data: { field: options.field, item } });
	}

	const work: Promise<any>[] = [];

	if (options.field === BriefcaseField.Licenses) {
		const license: License = item;

		if (suspend) {
			work.push(
				professionals.suspend(user, null, false, license.verificationText),
				auditTrail.insert({ action: 'USER_SUSPENDED', createdBy: sessionUser, user: user })
			);
		}

		if (verificationText) {
			(result as License).verificationText = verificationText;
		}
	}

	if (!user.briefcase?.completedAt) {
		work.push(sendCompletedNotifications(professionals, organizations, notificationService, urlShortener, serverSettings, user));
	}

	//	if (sessionUser.userType !== UserType.HospitalApi && user.affiliations?.some(i => !i.rejectedAt && i.organization.professionals?.webhooks?.fileUploaded)) {
	//		work.push(callFileUploadedWebhook(options.webhookTopicArn, user, fieldPath, `${s3Settings.s3Url}${toKey}`, result));
	//	}

	if (sessionUser.userType !== UserType.HospitalApi && user.affiliations?.some(i => !i.rejectedAt)) {
		work.push(callItemUpdatedWebhook(options.webhookTopicArn, user, options.field, item));
	}

	for (const key of updatedFiles.deleteKeys) {
		work.push(
			s3.deleteObject(
				{
					Bucket: s3Settings.s3Bucket,
					Key: key
				}
			).promise()
		);
	}

	await Promise.all(work);

	return result;
}

export async function deleteItem(options: DeleteItemOptions): Promise<boolean> {
	const connection = await getConnection(options.db.uri, options.db.poolSize, true);
	const dataSources = new DataSourceCollection();
	const [users, professionals, settings, auditTrail, uploadedFiles] = dataSources.add(
		new UserRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new ProfessionalRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new SettingsRepository({ driver: new MongoDbDataDriver(connection, options.db.dbName), useEnvVariables: true }),
		new UserAuditTrailRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new UploadedFileRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new DepartmentRepository(new MongoDbDataDriver(connection, options.db.dbName)),
		new HospitalRepository(new MongoDbDataDriver(connection, options.db.dbName))
	);
	const fieldName = fieldToPath(options.field);
	const userUpdate: Professional = {};

	userUpdate[fieldName] = [{ id: options.itemId }];

	let [s3Settings, sessionUser, user, briefcaseItem] = await Promise.all([
		settings.getSettings<S3Settings>(S3_SETTINGS),
		(options.session.userId === options.userId) ? undefined : users.findById(
			options.session.userId,
			{
				userType: 1,
				organization: 1
			}
		),
		professionals.findById(
			options.userId,
			Object.assign(
				{
					'intId': 1,
					'firstName': 1,
					'lastName': 1,
					'email': 1,
					'userType': 1,
					'affiliations.organization': 1,
					'affiliations.rejectedAt': 1,
					'affiliations.thirdPartySystems': 1,
					'affiliations.organization.professionals.webhooks.updated.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.updated.url': 1,
					'affiliations.organization.professionals.webhooks.updated.headers': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.url': 1,
					'affiliations.organization.professionals.webhooks.itemDeleted.headers': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.url': 1,
					'affiliations.organization.professionals.webhooks.itemUpdated.headers': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.httpMethod': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.url': 1,
					'affiliations.organization.professionals.webhooks.fileUploaded.headers': 1,
					'affiliations.recruiter.firstName': 1,
					'affiliations.recruiter.lastName': 1,
					'affiliations.recruiter.email': 1,
					'affiliations.recruiter.phoneNumber': 1
				},
				buildFileSelect(professionals.files, userUpdate)
			)
		),
		professionals.getBriefcaseItem(options.userId, options.field, options.itemId)
	]);

	if (options.session.userId === options.userId) {
		sessionUser = user;
	}

	if (!sessionUser || !user) {
		throw new UserNotFoundError();
	}

	if (!hasAccess(sessionUser, user)) {
		throw new UnauthorizedError();
	}

	const s3 = new S3({
		region: s3Settings.region,
		secretAccessKey: s3Settings.s3SecretAccessKey,
		accessKeyId: s3Settings.s3AccessKeyId
	});

	const updatedFiles = await updateFiles(professionals, uploadedFiles, s3, s3Settings, user, userUpdate);

	// Find the files of the briefcase item and add them to be deleted.
	for (const file of professionals.files) {
		for (const urlField of file.fileUrlFields) {
			for (const pathValue of getPathValues(`${file.path ? `${file.path}.` : ''}${urlField}`, userUpdate)) {
				if (typeof pathValue.value === 'string' && pathValue.value.startsWith(`${s3Settings.s3Url}${s3Settings.s3UploadFolder}`)) {
					updatedFiles.deleteKeys.push(pathValue.value.substring(s3Settings.s3Url.length));
				}
			}
		}
	}

	const result = await professionals.deleteBriefcaseItem(user, options.field, briefcaseItem);

	await auditTrail.insert({ action: 'USER_ITEM_DELETED', createdBy: sessionUser, user: user, data: { field: options.field, briefcaseItem } });

	for (const key of updatedFiles.deleteKeys) {
		await s3.deleteObject(
			{
				Bucket: s3Settings.s3Bucket,
				Key: key
			}
		).promise();
	}

	if (sessionUser.userType !== UserType.HospitalApi && user.affiliations?.some(i => !i.rejectedAt && i.organization.professionals?.webhooks?.itemDeleted)) {
		await callItemDeletedWebhook(options.webhookTopicArn, user, options.field, briefcaseItem);
	}

	return result;
}

async function updateFiles(professionals: ProfessionalRepository, uploadedFiles: UploadedFileRepository, s3: S3,
	s3Settings: S3Settings, existingUser: User, userUpdate: User): Promise<UpdatedFiles> {

	const uploadedFilesList = await uploadedFiles.find(
		{
			itemId: existingUser._id
		},
		{
			'objectId': 1,
			'path': 1,
			'url': 1,
			'uploadedAt': 1,
			'expiresAt': 1
		}
	).toArray();

	const fileValues = setFileValues(professionals.files, existingUser, userUpdate, uploadedFilesList);
	const result: UpdatedFiles = { deleteKeys: [], updatedItems: [] };

	for (const item of fileValues) {
		if (item.fileUpload) {
			const fileName = getFileName(item.file, existingUser, item.pathValue.parent);
			const fileExt = item.fileUpload.url.substring(item.fileUpload.url.lastIndexOf('.'));
			const toKey = `${s3Settings.s3UploadFolder}/${existingUser._id.toString()}${item.file.hasId ? `/${item.pathValue.parent.id.toString()}` : '' }/${Math.round(new Date().valueOf() / 1000)}/${fileName}${fileExt}`;
			const fromKey = item.fileUpload.url.substring(s3Settings.s3Url.length);

			if (typeof item.pathValue.value === 'string' && item.pathValue.value.startsWith(`${s3Settings.s3Url}${s3Settings.s3UploadFolder}`)) {
				const oldKey = item.pathValue.value.substring(s3Settings.s3Url.length);

				if (toKey !== oldKey && !item.file.history) {
					result.deleteKeys.push(oldKey);
				}
			}

			if (fromKey != toKey) {
				await s3.copyObject(
					{
						Bucket: s3Settings.s3Bucket,
						Key: toKey,
						CopySource: `${s3Settings.s3TempBucket}/${fromKey}`
					}
				).promise();

				result.updatedItems.push({ url: `${s3Settings.s3Url}${toKey}`, path: item.fileUpload.path, item: item.pathValue.parent });
			}

			item.pathValue.parent[item.pathValue.member] = `${s3Settings.s3Url}${toKey}`;

			if (item.file.uploadedAtField) {
				item.pathValue.parent[item.file.uploadedAtField] = item.fileUpload.uploadedAt;
			}

			const deletedFilesList = await uploadedFiles.delete(
				{
					_id: item.fileUpload._id
				}
			);
		}
	}

	return result;
}

async function callUpdatedWebhook(webhookTopicArn: string, professionals: ProfessionalRepository, user: Professional, select: any): Promise<void> {
	try {
		const snsService = new SNS();
		const updatedUser = await professionals.findById(user._id, select);

		for (const key in select) {
			const parts = key.split('.');

			if (parts.length === 1) {
				if (updatedUser[parts[0]] === undefined) {
					updatedUser[parts[0]] = null;
				}
			} else if (parts.length > 1 && (parts[0] === 'jobs' || parts[0] === 'briefcase') && isObject(updatedUser[parts[0]]) && updatedUser[parts[0]][parts[1]] === undefined) {
				updatedUser[parts[0]][parts[1]] = null;
			}
		}

		const jsonUpdatedUser = toJson(updatedUser);

		for (const item of user.affiliations) {
			if (!item.rejectedAt && item.organization.professionals?.webhooks?.updated) {
				await snsService.publish({
					Message: JSON.stringify({
						httpMethod: item.organization.professionals.webhooks.updated.httpMethod,
						url: item.organization.professionals.webhooks.updated.url,
						headers: item.organization.professionals.webhooks.updated.headers,
						body: {
							action: 'professionalUpdated',
							user: {
								_id: user._id,
								email: user.email,
								firstName: user.firstName,
								lastName: user.lastName,
								intId: user.intId,
								thirdPartySystems: item.thirdPartySystems,
								recruiter: item.recruiter
							},
							update: jsonUpdatedUser,
						}
					}),
					TopicArn: webhookTopicArn
				}).promise();
			}
		}
	}
	catch (err) {
		console.log(err);
	}
}

async function callItemUpdatedWebhook(webhookTopicArn: string, user: Professional, field: string, briefcaseItem: any): Promise<void> {
	try {
		const snsService = new SNS();
		const jsonItem = toJson(briefcaseItem);

		for (const item of user.affiliations) {
			if (!item.rejectedAt && item.organization.professionals?.webhooks?.itemUpdated) {
				await snsService.publish({
					Message: JSON.stringify({
						httpMethod: item.organization.professionals.webhooks.itemUpdated.httpMethod,
						url: item.organization.professionals.webhooks.itemUpdated.url,
						headers: item.organization.professionals.webhooks.itemUpdated.headers,
						body: {
							action: 'briefcaseItemUpdated',
							user: {
								_id: user._id,
								email: user.email,
								firstName: user.firstName,
								lastName: user.lastName,
								intId: user.intId,
								thirdPartySystems: item.thirdPartySystems,
								recruiter: item.recruiter
							},
							field,
							item: jsonItem
						}
					}),
					TopicArn: webhookTopicArn
				}).promise();
			}
		}
	}
	catch (err) {
		console.log(err);
	}
}

async function callItemDeletedWebhook(webhookTopicArn: string, user: Professional, field: string, briefcaseItem: any): Promise<void> {
	try {
		const snsService = new SNS();
		const jsonItem = toJson(briefcaseItem);

		for (const item of user.affiliations) {
			if (!item.rejectedAt && item.organization.professionals?.webhooks?.itemDeleted) {
				await snsService.publish({
					Message: JSON.stringify({
						httpMethod: item.organization.professionals.webhooks.itemDeleted.httpMethod,
						url: item.organization.professionals.webhooks.itemDeleted.url,
						headers: item.organization.professionals.webhooks.itemDeleted.headers,
						body: {
							action: 'briefcaseItemDeleted',
							user: {
								_id: user._id,
								email: user.email,
								firstName: user.firstName,
								lastName: user.lastName,
								intId: user.intId,
								thirdPartySystems: item.thirdPartySystems,
								recruiter: item.recruiter
							},
							field,
							item: jsonItem
						}
					}),
					TopicArn: webhookTopicArn
				}).promise();
			}
		}
	}
	catch (err) {
		console.log(err);
	}
}

async function callFileUploadedWebhook(webhookTopicArn: string, user: Professional, path: string, fileUrl: string, item: any): Promise<void> {
	try {
		const snsService = new SNS();

		for (const affiliation of user.affiliations) {
			if (!affiliation.rejectedAt && affiliation.organization.professionals?.webhooks?.fileUploaded) {
				await snsService.publish({
					Message: JSON.stringify({
						httpMethod: affiliation.organization.professionals.webhooks.fileUploaded.httpMethod,
						url: affiliation.organization.professionals.webhooks.fileUploaded.url,
						headers: affiliation.organization.professionals.webhooks.fileUploaded.headers,
						body: {
							action: 'fileUploaded',
							user: {
								_id: user._id,
								email: user.email,
								firstName: user.firstName,
								lastName: user.lastName,
								intId: user.intId,
								thirdPartySystems: affiliation.thirdPartySystems,
								recruiter: affiliation.recruiter
							},
							path,
							fileUrl,
							item: toJson(item)
						}
					}),
					TopicArn: webhookTopicArn
				}).promise();
			}
		}
	}
	catch (err) {
		console.log(err);
	}
}

function buildUpdateSelect(update: UpdateItem): any {
	const result = {};

	for (const key in update) {
		if (update[key] === undefined) {
			continue;
		}

		if (key === 'briefcase' || key === 'jobs') {
			for (const key2 in update[key]) {
				if (update[key][key2] === undefined) {
					continue;
				}

				result[`${key}.${key2}`] = 1;
			}

			continue;
		}

		result[key] = 1;
	}

	return result;
}

async function sendCompletedNotifications(professionals: ProfessionalRepository, organizations: HospitalRepository, notificationService: NotificationService,
	urlShortener: UrlShortenerRepository, serverSettings: ServerSettings, user: Professional): Promise<void> {

	const updatedUser = await professionals.findById(
		user._id,
		Object.assign(
			{
				'intId': 1,
				'firstName': 1,
				'lastName': 1,
				'email': 1,
				'phoneNumber': 1,
				'affiliations.thirdPartySystems': 1,
				'affiliations.recruiter.firstName': 1,
				'affiliations.recruiter.lastName': 1,
				'affiliations.recruiter.email': 1,
				'affiliations.recruiter.phone': 1,
				'affiliations.rejectedAt': 1,
				'briefcase.completedAt': 1,
				'briefcase.licenses.licenseType': 1
			},
			getUserBrandingSelect(),
			getOrganizationBrandingSelect('affiliations.organization')
		)
	);

	if (updatedUser?.briefcase?.completedAt) {
		const branding = await professionals.getBranding(updatedUser);
		let ceufastToken = crypto.createHash('sha256').update(`${updatedUser.email}-2150ce7f-b42c-4557-85e8-9b4dd70d0384`);

		const notifications: SendOptions[] = [
			{
				template: branding.isPrn ? 'PROFILE_COMPLETED_NURSE_PRN' : 'PROFILE_COMPLETED_NURSE_MARKETPLACE',
				templateArgs: {
					firstName: updatedUser.firstName,
					hipaa: await urlShortener.shortenUrl(`https://ceufast.com/register?r=praos&c=3477&e=${updatedUser.email}&t=${ceufastToken.digest('hex')}`),
					facilityAddress: branding.facilityAddress,
					facilityLogo: branding.facilityLogo,
					facilityName: branding.facilityName
				},
				email: {
					to: updatedUser.email
				}
			}
		];

		if (updatedUser.affiliations) {
			let share: Share;

			for (const affiliation of updatedUser.affiliations) {
				if (!affiliation.rejectedAt && affiliation.recruiter?.email) {
					const orgBranding = await organizations.getBranding2(affiliation.organization);

					if (!share) {
						share = await professionals.shareBriefcase(updatedUser, 'overview');
					}

					notifications.push({
						template: 'BRIEFCASE_COMPLETED_TO_RECRUITER',
						templateArgs: {
							jobOwnerName: [affiliation.recruiter.firstName, affiliation.recruiter.lastName].filter(Boolean).join(' '),
							nurseId: updatedUser.intId,
							nurseEmail: updatedUser.email,
							nursePhone: updatedUser.phoneNumber,
							nurseFullName: `${updatedUser.firstName} ${updatedUser.lastName}`,
							licenseType: updatedUser.briefcase?.licenses?.[0].licenseType || '',
							nurseLastName: updatedUser.lastName,
							briefcaseLink: `${serverSettings.briefcasePanelUrl}${updatedUser._id.toString()}?token=${share.token}`,
							facilityName: orgBranding.facilityName,
							facilityAddress: orgBranding.facilityAddress,
							facilityLogo: orgBranding.facilityLogo
						},
						email: {
							to: affiliation.recruiter.email
						}
					});
				}
			}
		}

		await notificationService.send(notifications);
	}
}
