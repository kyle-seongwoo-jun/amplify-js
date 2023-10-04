// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defaultStorage } from '@aws-amplify/core';
import { syncMessages } from '../../../../../src/inAppMessaging/providers/pinpoint/apis';
import {
	STORAGE_KEY_SUFFIX,
	resolveCredentials,
	resolveConfig,
	getInAppMessagingUserAgentString,
} from '../../../../../src/inAppMessaging/providers/pinpoint/utils';
import { simpleInAppMessages } from '../../../../../__mocks__/data';
import {
	updateEndpoint,
	getEndpointId,
} from '@aws-amplify/core/internals/providers/pinpoint';
import { getInAppMessages } from '@aws-amplify/core/internals/aws-clients/pinpoint';
import { InAppMessagingError } from '../../../../../src/inAppMessaging/errors';

jest.mock('@aws-amplify/core/internals/aws-clients/pinpoint');
jest.mock('@aws-amplify/core');
jest.mock('@aws-amplify/core/internals/utils');
jest.mock('@aws-amplify/core/internals/providers/pinpoint');
jest.mock('../../../../../src/inAppMessaging/providers/pinpoint/utils');

const mockDefaultStorage = defaultStorage as jest.Mocked<typeof defaultStorage>;
const mockResolveCredentials = resolveCredentials as jest.Mock;
const mockUpdateEndpoint = updateEndpoint as jest.Mock;
const mockGetEndpointId = getEndpointId as jest.Mock;
const mockGetInAppMessages = getInAppMessages as jest.Mock;
const mockGetInAppMessagingUserAgentString =
	getInAppMessagingUserAgentString as jest.Mock;
const mockResolveConfig = resolveConfig as jest.Mock;
const credentials = {
	credentials: {
		accessKeyId: 'access-key-id',
		secretAccessKey: 'secret-access-key',
	},
	identityId: 'identity-id',
};
const config = { appId: 'app-id', region: 'region' };
const userAgentValue = 'user-agent-value';
const mockedHappyMessages = {
	InAppMessagesResponse: {
		InAppMessageCampaigns: simpleInAppMessages,
	},
};
const mockedEmptyMessages = {
	InAppMessagesResponse: {
		InAppMessageCampaigns: [],
	},
};

describe('syncMessages', () => {
	beforeAll(() => {
		mockGetInAppMessagingUserAgentString.mockReturnValue(userAgentValue);
		mockResolveConfig.mockReturnValue(config);
		mockResolveCredentials.mockResolvedValue(credentials);
		mockGetInAppMessages.mockResolvedValue(mockedHappyMessages);
	});

	beforeEach(() => {
		mockUpdateEndpoint.mockClear();
		mockDefaultStorage.setItem.mockClear();
	});
	it('Gets in-app messages and stores them when endpointId is already available in cache', async () => {
		mockGetEndpointId.mockReturnValueOnce('endpoint-id');

		await syncMessages();

		expect(mockDefaultStorage.setItem).toBeCalledWith(
			expect.stringContaining(STORAGE_KEY_SUFFIX),
			JSON.stringify(simpleInAppMessages)
		);
	});

	it('Creates an endpointId when not available and gets the messages', async () => {
		mockGetEndpointId
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce('endpoint-id');
		await syncMessages();

		expect(mockDefaultStorage.setItem).toBeCalledWith(
			expect.stringContaining(STORAGE_KEY_SUFFIX),
			JSON.stringify(simpleInAppMessages)
		);
	});

	it('Only tries to store messages if there are messages to store', async () => {
		mockGetEndpointId.mockReturnValueOnce('endpoint-id');
		mockGetInAppMessages.mockResolvedValueOnce(mockedEmptyMessages);
		await syncMessages();

		expect(mockDefaultStorage.setItem).not.toBeCalled();
	});

	it('Rejects if there is a validation error', async () => {
		await expect(syncMessages()).rejects.toStrictEqual(
			expect.any(InAppMessagingError)
		);

		expect(mockDefaultStorage.setItem).not.toBeCalled();
	});
	it('Rejects if there is a failure getting messages', async () => {
		mockGetEndpointId.mockReturnValueOnce('endpoint-id');
		mockGetInAppMessages.mockRejectedValueOnce(Error);
		await expect(syncMessages()).rejects.toStrictEqual(
			expect.any(InAppMessagingError)
		);

		expect(mockDefaultStorage.setItem).not.toBeCalled();
	});
	it('Rejects if there is a failure storing messages', async () => {
		mockGetEndpointId.mockReturnValueOnce('endpoint-id');
		mockDefaultStorage.setItem.mockRejectedValueOnce(Error);
		await expect(syncMessages()).rejects.toStrictEqual(
			expect.any(InAppMessagingError)
		);
	});
});