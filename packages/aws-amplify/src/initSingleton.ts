// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
	Amplify,
	CookieStorage,
	LibraryOptions,
	ResourcesConfig,
	defaultStorage,
} from '@aws-amplify/core';
import {
	AmplifyOutputsUnknown,
	LegacyConfig,
	parseAmplifyConfig,
} from '@aws-amplify/core/internals/utils';

import {
	CognitoAWSCredentialsAndIdentityIdProvider,
	DefaultIdentityIdStore,
	cognitoCredentialsProvider,
	cognitoUserPoolsTokenProvider,
} from './auth/cognito';

export const DefaultAmplify = {
	/**
	 * Configures Amplify with the {@link resourceConfig} and {@link libraryOptions}.
	 *
	 * @param resourceConfig The {@link ResourcesConfig} object that is typically imported from the
	 * `amplifyconfiguration.json` file. It can also be an object literal created inline when calling `Amplify.configure`.
	 * @param libraryOptions The {@link LibraryOptions} additional options for the library.
	 *
	 * @example
	 * import config from './amplifyconfiguration.json';
	 *
	 * Amplify.configure(config);
	 */
	configure(
		resourceConfig: ResourcesConfig | LegacyConfig | AmplifyOutputsUnknown,
		libraryOptions?: LibraryOptions,
	): void {
		const resolvedResourceConfig = parseAmplifyConfig(resourceConfig);
		const cookieBasedKeyValueStorage = new CookieStorage({ sameSite: 'lax' });
		const resolvedKeyValueStorage = libraryOptions?.ssr
			? cookieBasedKeyValueStorage
			: defaultStorage;
		const resolvedCredentialsProvider = libraryOptions?.ssr
			? new CognitoAWSCredentialsAndIdentityIdProvider(
					new DefaultIdentityIdStore(cookieBasedKeyValueStorage),
				)
			: cognitoCredentialsProvider;

		// If no Auth config is provided, no special handling will be required, configure as is.
		// Otherwise, we can assume an Auth config is provided from here on.
		if (!resolvedResourceConfig.Auth) {
			Amplify.configure(resolvedResourceConfig, libraryOptions);

			return;
		}

		// If Auth options are provided, always just configure as is.
		// Otherwise, we can assume no Auth libraryOptions were provided from here on.
		if (libraryOptions?.Auth) {
			Amplify.configure(resolvedResourceConfig, libraryOptions);

			return;
		}

		// If no Auth libraryOptions were previously configured, then always add default providers.
		if (!Amplify.libraryOptions.Auth) {
			cognitoUserPoolsTokenProvider.setAuthConfig(resolvedResourceConfig.Auth);
			cognitoUserPoolsTokenProvider.setKeyValueStorage(
				// TODO: allow configure with a public interface
				resolvedKeyValueStorage,
			);

			Amplify.configure(resolvedResourceConfig, {
				...libraryOptions,
				Auth: {
					tokenProvider: cognitoUserPoolsTokenProvider,
					credentialsProvider: resolvedCredentialsProvider,
				},
			});

			return;
		}

		// At this point, Auth libraryOptions would have been previously configured and no overriding
		// Auth options were given, so we should preserve the currently configured Auth libraryOptions.
		if (libraryOptions) {
			const authLibraryOptions = Amplify.libraryOptions.Auth;
			// If ssr is provided through libraryOptions, we should respect the intentional reconfiguration.
			if (libraryOptions.ssr !== undefined) {
				cognitoUserPoolsTokenProvider.setKeyValueStorage(
					// TODO: allow configure with a public interface
					resolvedKeyValueStorage,
				);

				authLibraryOptions.credentialsProvider = resolvedCredentialsProvider;
			}

			Amplify.configure(resolvedResourceConfig, {
				Auth: authLibraryOptions,
				...libraryOptions,
			});

			return;
		}

		// Finally, if there were no libraryOptions given at all, we should simply not touch the currently
		// configured libraryOptions.
		Amplify.configure(resolvedResourceConfig);
	},
	/**
	 * Returns the {@link ResourcesConfig} object passed in as the `resourceConfig` parameter when calling
	 * `Amplify.configure`.
	 *
	 * @returns An {@link ResourcesConfig} object.
	 */
	getConfig(): ResourcesConfig {
		return Amplify.getConfig();
	},
};
