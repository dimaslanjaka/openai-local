export type AuthProvider = "antigravity" | "codex" | "copilot" | "zed" | "kiro"
export type AuthSource = "codex-cli" | "cli-proxy" | "zed-local" | "kiro-local" | "kiro-cli" | "kiro-refresh-token"

export interface ProviderAccount {
    id: string
    provider: AuthProvider
    email?: string
    login?: string
    label?: string
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    projectId?: string
    organizationId?: string
    serverUrl?: string
    authSource?: AuthSource
    metadata?: Record<string, unknown>
    createdAt?: string
    updatedAt?: string
}

export interface ProviderAccountSummary {
    id: string
    provider: AuthProvider
    displayName: string
    email?: string
    login?: string
    label?: string
    expiresAt?: number
}
