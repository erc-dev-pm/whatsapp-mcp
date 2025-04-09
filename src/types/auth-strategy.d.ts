import { Client } from '../Client';

export interface AuthStrategy {
    setup(client: Client): void;
    onAuthenticationNeeded(): Promise<{
        failed: boolean;
        failureEventPayload?: string;
        restart?: boolean;
    }>;
    getAuthEventPayload(): Promise<any>;
}

export interface Session {
    WABrowserId?: string;
    WASecretBundle?: string;
    WAToken1?: string;
    WAToken2?: string;
} 