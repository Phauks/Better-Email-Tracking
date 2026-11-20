/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** InboxSDK app id; register one free at https://www.inboxsdk.com/register */
	readonly VITE_INBOXSDK_APP_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
