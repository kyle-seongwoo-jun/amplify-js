// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AWSCredentials } from '@aws-amplify/core/internals/utils';
import { Amplify, StorageAccessLevel } from '@aws-amplify/core';

import { getObject } from '../../../../../src/providers/s3/utils/client/s3data';
import { downloadData } from '../../../../../src/providers/s3/apis/internal/downloadData';
import {
	createDownloadTask,
	validateStorageOperationInput,
} from '../../../../../src/providers/s3/utils';
import {
	DownloadDataInput,
	DownloadDataWithPathInput,
} from '../../../../../src/providers/s3/types';
import {
	STORAGE_INPUT_KEY,
	STORAGE_INPUT_PATH,
} from '../../../../../src/providers/s3/utils/constants';
import { StorageDownloadDataOutput } from '../../../../../src/types';
import {
	ItemWithKey,
	ItemWithPath,
} from '../../../../../src/providers/s3/types/outputs';
import './testUtils';
import { BucketInfo } from '../../../../../src/providers/s3/types/options';

jest.mock('../../../../../src/providers/s3/utils/client/s3data');
jest.mock('../../../../../src/providers/s3/utils');
jest.mock('@aws-amplify/core', () => ({
	ConsoleLogger: jest.fn().mockImplementation(function ConsoleLogger() {
		return { debug: jest.fn() };
	}),
	Amplify: {
		getConfig: jest.fn(),
		Auth: {
			fetchAuthSession: jest.fn(),
		},
	},
}));
const credentials: AWSCredentials = {
	accessKeyId: 'accessKeyId',
	sessionToken: 'sessionToken',
	secretAccessKey: 'secretAccessKey',
};
const inputKey = 'key';
const inputPath = 'path';
const bucket = 'bucket';
const region = 'region';
const targetIdentityId = 'targetIdentityId';
const defaultIdentityId = 'defaultIdentityId';
const validBucketOwner = '111122223333';
const mockDownloadResultBase = {
	body: 'body',
	lastModified: 'lastModified',
	size: 'contentLength',
	eTag: 'eTag',
	metadata: 'metadata',
	versionId: 'versionId',
	contentType: 'contentType',
};

const mockFetchAuthSession = Amplify.Auth.fetchAuthSession as jest.Mock;
const mockCreateDownloadTask = createDownloadTask as jest.Mock;
const mockValidateStorageInput = validateStorageOperationInput as jest.Mock;
const mockGetConfig = jest.mocked(Amplify.getConfig);

describe('downloadData with key', () => {
	beforeAll(() => {
		mockFetchAuthSession.mockResolvedValue({
			credentials,
			identityId: defaultIdentityId,
		});
		mockGetConfig.mockReturnValue({
			Storage: {
				S3: {
					bucket,
					region,
					buckets: { 'default-bucket': { bucketName: bucket, region } },
				},
			},
		});
	});

	beforeEach(() => {
		jest.clearAllMocks();

		mockCreateDownloadTask.mockReturnValue('downloadTask');
		mockValidateStorageInput.mockReturnValue({
			inputType: STORAGE_INPUT_KEY,
			objectKey: inputKey,
		});
	});

	it('should return a download task with key', async () => {
		const mockDownloadInput: DownloadDataInput = {
			key: inputKey,
			options: { accessLevel: 'protected', targetIdentityId },
		};
		expect(downloadData(mockDownloadInput)).toBe('downloadTask');
	});

	const testCases: {
		expectedKey: string;
		options?: { accessLevel?: StorageAccessLevel; targetIdentityId?: string };
	}[] = [
		{
			expectedKey: `public/${inputKey}`,
		},
		{
			options: { accessLevel: 'guest' },
			expectedKey: `public/${inputKey}`,
		},
		{
			options: { accessLevel: 'private' },
			expectedKey: `private/${defaultIdentityId}/${inputKey}`,
		},
		{
			options: { accessLevel: 'protected' },
			expectedKey: `protected/${defaultIdentityId}/${inputKey}`,
		},
		{
			options: { accessLevel: 'protected', targetIdentityId },
			expectedKey: `protected/${targetIdentityId}/${inputKey}`,
		},
	];

	test.each(testCases)(
		'should supply the correct parameters to getObject API handler with $expectedKey accessLevel',
		async ({ options, expectedKey }) => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			const onProgress = jest.fn();
			downloadData({
				key: inputKey,
				options: {
					...options,
					useAccelerateEndpoint: true,
					onProgress,
				},
			});
			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			const { key, body }: StorageDownloadDataOutput<ItemWithKey> = await job();
			expect({ key, body }).toEqual({
				key: inputKey,
				body: 'body',
			});
			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				{
					credentials,
					region,
					useAccelerateEndpoint: true,
					onDownloadProgress: onProgress,
					abortSignal: expect.any(AbortSignal),
					userAgentValue: expect.any(String),
				},
				{
					Bucket: bucket,
					Key: expectedKey,
				},
			);
		},
	);

	it('should assign the getObject API handler response to the result with key', async () => {
		(getObject as jest.Mock).mockResolvedValueOnce({
			Body: 'body',
			LastModified: 'lastModified',
			ContentLength: 'contentLength',
			ETag: 'eTag',
			Metadata: 'metadata',
			VersionId: 'versionId',
			ContentType: 'contentType',
		});
		downloadData({ key: inputKey });
		const { job } = mockCreateDownloadTask.mock.calls[0][0];
		const {
			key,
			body,
			contentType,
			eTag,
			lastModified,
			metadata,
			size,
			versionId,
		}: StorageDownloadDataOutput<ItemWithKey> = await job();
		expect(getObject).toHaveBeenCalledTimes(1);
		expect({
			key,
			body,
			contentType,
			eTag,
			lastModified,
			metadata,
			size,
			versionId,
		}).toEqual({
			key: inputKey,
			...mockDownloadResultBase,
		});
	});

	it('should forward the bytes range option to the getObject API', async () => {
		const start = 1;
		const end = 100;
		(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });

		downloadData({
			key: inputKey,
			options: {
				bytesRange: { start, end },
			},
		});

		const { job } = mockCreateDownloadTask.mock.calls[0][0];
		await job();

		expect(getObject).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				Range: `bytes=${start}-${end}`,
			}),
		);
	});

	describe('bucket passed in options', () => {
		it('should override bucket in getObject call when bucket is object', async () => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			const abortController = new AbortController();
			const bucketInfo: BucketInfo = {
				bucketName: 'bucket-1',
				region: 'region-1',
			};

			downloadData({
				key: inputKey,
				options: {
					bucket: bucketInfo,
				},
			});

			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			await job();

			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				{
					credentials,
					region: bucketInfo.region,
					abortSignal: abortController.signal,
					userAgentValue: expect.any(String),
				},
				{
					Bucket: bucketInfo.bucketName,
					Key: `public/${inputKey}`,
				},
			);
		});

		it('should override bucket in getObject call when bucket is string', async () => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			const abortController = new AbortController();

			downloadData({
				key: inputKey,
				options: {
					bucket: 'default-bucket',
				},
			});

			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			await job();

			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				{
					credentials,
					region,
					abortSignal: abortController.signal,
					userAgentValue: expect.any(String),
				},
				{
					Bucket: bucket,
					Key: `public/${inputKey}`,
				},
			);
		});
	});

	describe('ExpectedBucketOwner passed in options', () => {
		it('should include expectedBucketOwner in headers when provided', async () => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			downloadData({
				key: inputKey,
				options: {
					expectedBucketOwner: validBucketOwner,
				},
			});

			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			await job();

			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				expect.any(Object),
				expect.objectContaining({
					ExpectedBucketOwner: validBucketOwner,
				}),
			);
		});
	});
});

describe('downloadData with path', () => {
	beforeAll(() => {
		mockFetchAuthSession.mockResolvedValue({
			credentials,
			identityId: defaultIdentityId,
		});
		mockGetConfig.mockReturnValue({
			Storage: {
				S3: {
					bucket,
					region,
					buckets: { 'default-bucket': { bucketName: bucket, region } },
				},
			},
		});
		mockCreateDownloadTask.mockReturnValue('downloadTask');
		mockValidateStorageInput.mockReturnValue({
			inputType: STORAGE_INPUT_PATH,
			objectKey: inputPath,
		});
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should return a download task with path', async () => {
		const mockDownloadInput: DownloadDataWithPathInput = {
			path: inputPath,
			options: { useAccelerateEndpoint: true },
		};
		expect(downloadData(mockDownloadInput)).toBe('downloadTask');
	});

	test.each([
		{
			path: inputPath,
			expectedKey: inputPath,
		},
		{
			path: () => inputPath,
			expectedKey: inputPath,
		},
	])(
		'should call getObject API with $expectedKey when path provided is $path',
		async ({ path, expectedKey }) => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			const onProgress = jest.fn();
			downloadData({
				path,
				options: {
					useAccelerateEndpoint: true,
					onProgress,
				},
			});
			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			const {
				path: resultPath,
				body,
			}: StorageDownloadDataOutput<ItemWithPath> = await job();
			expect({
				path: resultPath,
				body,
			}).toEqual({
				path: expectedKey,
				body: 'body',
			});
			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				{
					credentials,
					region,
					useAccelerateEndpoint: true,
					onDownloadProgress: onProgress,
					abortSignal: expect.any(AbortSignal),
					userAgentValue: expect.any(String),
				},
				{
					Bucket: bucket,
					Key: expectedKey,
				},
			);
		},
	);

	it('should assign the getObject API handler response to the result with path', async () => {
		(getObject as jest.Mock).mockResolvedValueOnce({
			Body: 'body',
			LastModified: 'lastModified',
			ContentLength: 'contentLength',
			ETag: 'eTag',
			Metadata: 'metadata',
			VersionId: 'versionId',
			ContentType: 'contentType',
		});
		downloadData({ path: inputPath });
		const { job } = mockCreateDownloadTask.mock.calls[0][0];
		const {
			path,
			body,
			contentType,
			eTag,
			lastModified,
			metadata,
			size,
			versionId,
		}: StorageDownloadDataOutput<ItemWithPath> = await job();
		expect(getObject).toHaveBeenCalledTimes(1);
		expect({
			path,
			body,
			contentType,
			eTag,
			lastModified,
			metadata,
			size,
			versionId,
		}).toEqual({
			path: inputPath,
			...mockDownloadResultBase,
		});
	});

	it('should forward the bytes range option to the getObject API', async () => {
		const start = 1;
		const end = 100;
		(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });

		downloadData({
			path: inputPath,
			options: {
				bytesRange: { start, end },
			},
		});

		const { job } = mockCreateDownloadTask.mock.calls[0][0];
		await job();

		expect(getObject).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				Range: `bytes=${start}-${end}`,
			}),
		);
	});

	describe('bucket passed in options', () => {
		it('should override bucket in getObject call when bucket is object', async () => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			const abortController = new AbortController();
			const bucketInfo: BucketInfo = {
				bucketName: 'bucket-1',
				region: 'region-1',
			};

			downloadData({
				path: inputPath,
				options: {
					bucket: bucketInfo,
				},
			});

			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			await job();

			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				{
					credentials,
					region: bucketInfo.region,
					abortSignal: abortController.signal,
					userAgentValue: expect.any(String),
				},
				{
					Bucket: bucketInfo.bucketName,
					Key: inputPath,
				},
			);
		});

		it('should override bucket in getObject call when bucket is string', async () => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			const abortController = new AbortController();

			downloadData({
				path: inputPath,
				options: {
					bucket: 'default-bucket',
				},
			});

			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			await job();

			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				{
					credentials,
					region,
					abortSignal: abortController.signal,
					userAgentValue: expect.any(String),
				},
				{
					Bucket: bucket,
					Key: inputPath,
				},
			);
		});
	});

	describe('ExpectedBucketOwner passed in options', () => {
		it('should include expectedBucketOwner in headers when provided', async () => {
			(getObject as jest.Mock).mockResolvedValueOnce({ Body: 'body' });
			downloadData({
				path: inputKey,
				options: {
					expectedBucketOwner: validBucketOwner,
				},
			});

			const { job } = mockCreateDownloadTask.mock.calls[0][0];
			await job();

			expect(getObject).toHaveBeenCalledTimes(1);
			await expect(getObject).toBeLastCalledWithConfigAndInput(
				expect.any(Object),
				expect.objectContaining({
					ExpectedBucketOwner: validBucketOwner,
				}),
			);
		});
	});
});
