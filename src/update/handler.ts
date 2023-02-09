import { Context, SNSEvent } from 'aws-lambda';
import { deleteItem, updateItem, updateProfessional } from './update';
import { JwtSession } from '@carry/praos/session/jwt-session';
import { UnauthorizedError } from '@carry/core/errors';
import { toJson } from '@carry/core/utilities/object';
import { toHttpError } from '../helper';
import { parseProfessional } from '@carry/praos/professional/professional';
import { Gender } from '@carry/praos/user/user';
import { Address } from '@carry/praos/location/address';
import { EmergencyContact } from '@carry/praos/professional/emergency-contact';
import { WorkCity } from '@carry/praos/professional/job-info';
import { License } from '@carry/praos/professional/license';
import { Certification } from '@carry/praos/professional/certification';
import { AdditionalCertification } from '@carry/praos/professional/additional-certification';
import { Facility } from '@carry/praos/professional/facility';
import { DriversLicense } from '@carry/praos/professional/drivers-license';
import { Reference } from '@carry/praos/professional/reference';
import {
	ContinuingEducation,
	Education,
	EducationDocument,
} from '@carry/praos/professional/education';
import { WorkExperience } from '@carry/praos/professional/work-experience';
import { Competency } from '@carry/praos/professional/competency';
import { OrganizationMembership } from '@carry/praos/professional/organization-membership';
import { ActivityWork } from '@carry/praos/professional/activity-work';
import { HealthDocument } from '@carry/praos/professional/health-document';
import { AdditionalDocument } from '@carry/praos/professional/additional-document';
import { LiabilityInsurance } from '@carry/praos/professional/liability-insurance';
import { VehicleInsurance } from '@carry/praos/professional/vehicle-insurance';
import { BriefcaseField, parseBriefcaseItem } from '@carry/praos/professional/briefcase';

const AUTHORIZATION_TOKEN = process.env.AUTHORIZATION_TOKEN;
const DATABASE_URI = process.env.DATABASE_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const DATABASE_POOL_SIZE = parseInt(process.env.DATABASE_POOL_SIZE);
const PROFESSIONAL_WEBHOOK_TOPIC_ARN = process.env.PROFESSIONAL_WEBHOOK_TOPIC_ARN;

type UpdateProfessionalRequest =
	| BulkUpdateRequest
	| UpdateItemRequest
	| AddItemRequest
	| DeleteItemRequest;

type BulkUpdateRequest = {
	_session: JwtSession;
	_field: string;
	_method: '';
	select: any;
	item: {
		id?: string;
		firstName?: string;
		lastName?: string;
		dateOfBirth?: Date;
		gender?: Gender;
		email?: string;
		profilePicUrl?: null;
		phoneNumber?: string;
		address?: Address;
		ssn?: string;
		languages?: string[];
		emergencyContact?: EmergencyContact;
		emailCommunicationEnabled?: boolean;
		profession?: string;
		jobs?: {
			workCities?: WorkCity[];
			workStates?: string[];
			workDistance?: number;
		};
		briefcase?: {
			activityWork?: ActivityWork[];
			additionalCertifications?: AdditionalCertification[];
			additionalDocuments?: AdditionalDocument[];
			certifications?: Certification[];
			competencies?: Competency[];
			consentedAt?: boolean;
			continuingEducation?: ContinuingEducation[];
			currentStep?: number;
			driversLicense?: DriversLicense;
			educationLevel?: string;
			education?: Education[];
			educationDocuments?: EducationDocument[];
			ehrSkills?: string[];
			facilities?: Facility[];
			healthDocuments?: HealthDocument[];
			liabilityInsurance?: LiabilityInsurance;
			licenses?: License[];
			nursys?: { isEnabled?: boolean };
			organizationMembership?: OrganizationMembership[];
			references?: Reference[];
			specialties?: string[];
			vehicleInsurance?: VehicleInsurance;
			w9?: string;
			workExperience?: WorkExperience;
			yearsOfExperience?: string;
		};
	};
};

type UpdateItemRequest = {
	_session: JwtSession;
	_method: 'PUT';
	_field: BriefcaseField;
	id?: string;
	item: { id: any };
};

type AddItemRequest = {
	_session: JwtSession;
	_method: 'POST';
	_field: BriefcaseField;
	id?: string;
	item: { id: any };
};

type DeleteItemRequest = {
	_session: JwtSession;
	_method: 'DELETE';
	_field: BriefcaseField;
	id?: string;
	item: { id: any };
};

export async function handler(request: UpdateProfessionalRequest, context: Context): Promise<any> {
	context.callbackWaitsForEmptyEventLoop = false;

	// request._session = { id: '', userId: '637d0a0cc2d7c20008ed677e', userType: UserType.HospitalAdmin, date: new Date() };

	try {
		if (!request._session) {
			throw new UnauthorizedError();
		}

		let result: any;

		if (request._method == 'POST' || request._method == 'PUT') {
			delete (request.item as any)._field;

			result = await updateItem({
				authToken: AUTHORIZATION_TOKEN,
				db: {
					uri: DATABASE_URI,
					dbName: DATABASE_NAME,
					poolSize: DATABASE_POOL_SIZE,
				},
				webhookTopicArn: PROFESSIONAL_WEBHOOK_TOPIC_ARN,
				session: request._session,
				userId: request.id,
				field: request._field,
				add: request._method == 'POST',
				item: parseBriefcaseItem(request._field, request.item),
			});
		} else if (request._method == 'DELETE') {
			await deleteItem({
				db: {
					uri: DATABASE_URI,
					dbName: DATABASE_NAME,
					poolSize: DATABASE_POOL_SIZE,
				},
				webhookTopicArn: PROFESSIONAL_WEBHOOK_TOPIC_ARN,
				session: request._session,
				userId: request.id,
				field: request._field,
				itemId: request.item.id,
			});
		} else {
			parseProfessional(request.item);

			result = await updateProfessional({
				authToken: AUTHORIZATION_TOKEN,
				db: {
					uri: DATABASE_URI,
					dbName: DATABASE_NAME,
					poolSize: DATABASE_POOL_SIZE,
				},
				webhookTopicArn: PROFESSIONAL_WEBHOOK_TOPIC_ARN,
				session: request._session,
				userId: request.item.id,
				item: {
					firstName: request.item.firstName,
					lastName: request.item.lastName,
					dateOfBirth: request.item.dateOfBirth,
					gender: request.item.gender,
					profilePicUrl: request.item.profilePicUrl,
					email: request.item.email ? request.item.email.toLowerCase() : request.item.email,
					phoneNumber: request.item.phoneNumber,
					address: request.item.address,
					ssn: request.item.ssn,
					languages: request.item.languages,
					emergencyContact: request.item.emergencyContact,
					jobs: request.item.jobs,
					emailCommunicationEnabled: request.item.emailCommunicationEnabled,
					briefcase: request.item.briefcase,
					profession: request.item.profession,
				},
				select: request.select,
				externalSource: null,
			});
		}

		return toJson(result);
	} catch (err) {
		err = toHttpError(err);

		throw err;
	}
}
