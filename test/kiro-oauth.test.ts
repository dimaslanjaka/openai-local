import { test, expect } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

function withTempHome(): { dir: string; prevHome: string | undefined; prevProfile: string | undefined; prevDataDir: string | undefined } {
    const dir = join(tmpdir(), `anti-api-kiro-${Date.now()}`)
    mkdirSync(join(dir, ".aws", "sso", "cache"), { recursive: true })
    mkdirSync(join(dir, ".anti-api"), { recursive: true })
    const prevHome = process.env.HOME
    const prevProfile = process.env.USERPROFILE
    const prevDataDir = process.env.ANTI_API_DATA_DIR
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    process.env.ANTI_API_DATA_DIR = join(dir, ".anti-api")
    return { dir, prevHome, prevProfile, prevDataDir }
}

function restoreEnv(prevHome: string | undefined, prevProfile: string | undefined, prevDataDir: string | undefined) {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevProfile
    if (prevDataDir === undefined) delete process.env.ANTI_API_DATA_DIR
    else process.env.ANTI_API_DATA_DIR = prevDataDir
}

test("kiro import accepts a valid local token without forcing refresh", async () => {
    const { dir, prevHome, prevProfile, prevDataDir } = withTempHome()
    writeFileSync(
        join(dir, ".aws", "sso", "cache", "kiro-auth-token.json"),
        JSON.stringify({
            accessToken: "local-access-token",
            refreshToken: "local-refresh-token",
            profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            region: "us-east-1",
        }, null, 2)
    )

    const { importKiroAuthSources } = await import(`../src/services/kiro/oauth.ts?${Date.now()}`)
    const { authStore } = await import(`../src/services/auth/store.ts?${Date.now()}`)

    const result = await importKiroAuthSources()
    expect(result.accounts.length).toBe(1)
    expect(result.sources.length).toBe(1)
    expect(authStore.listAccounts("kiro").length).toBe(1)

    rmSync(dir, { recursive: true, force: true })
    restoreEnv(prevHome, prevProfile, prevDataDir)
})
