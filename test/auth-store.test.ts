import { test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

function withTempHome(): { dir: string; prevHome: string | undefined; prevProfile: string | undefined } {
    const dir = mkdtempSync(join(tmpdir(), "anti-api-test-"))
    const prevHome = process.env.HOME
    const prevProfile = process.env.USERPROFILE
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    return { dir, prevHome, prevProfile }
}

function restoreEnv(prevHome: string | undefined, prevProfile: string | undefined) {
    if (prevHome === undefined) {
        delete process.env.HOME
    } else {
        process.env.HOME = prevHome
    }
    if (prevProfile === undefined) {
        delete process.env.USERPROFILE
    } else {
        process.env.USERPROFILE = prevProfile
    }
}

test("authStore saves and lists accounts", async () => {
    const { dir, prevHome, prevProfile } = withTempHome()
    const { authStore } = await import(`../src/services/auth/store.ts?${Date.now()}`)

    authStore.saveAccount({
        id: "acc-1",
        provider: "antigravity",
        email: "user@example.com",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
    })

    const accounts = authStore.listAccounts("antigravity")
    expect(accounts.length).toBe(1)
    expect(accounts[0].email).toBe("user@example.com")

    const summaries = authStore.listSummaries("antigravity")
    expect(summaries[0].displayName).toBe("user@example.com")

    rmSync(dir, { recursive: true, force: true })
    restoreEnv(prevHome, prevProfile)
})

test("authStore saves and lists kiro accounts", async () => {
    const { dir, prevHome, prevProfile } = withTempHome()
    const { authStore } = await import(`../src/services/auth/store.ts?${Date.now()}`)

    authStore.saveAccount({
        id: "arn:aws:codewhisperer:us-east-1:123:profile/test",
        provider: "kiro",
        label: "Kiro Google",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
        projectId: "arn:aws:codewhisperer:us-east-1:123:profile/test",
        authSource: "kiro-local",
    })

    const accounts = authStore.listAccounts("kiro")
    expect(accounts.length).toBe(1)
    expect(accounts[0].label).toBe("Kiro Google")
    expect(accounts[0].authSource).toBe("kiro-local")

    const summaries = authStore.listSummaries("kiro")
    expect(summaries[0].displayName).toBe("Kiro Google")

    rmSync(dir, { recursive: true, force: true })
    restoreEnv(prevHome, prevProfile)
})

test("authStore rate limit toggles state", async () => {
    const { dir, prevHome, prevProfile } = withTempHome()
    const { authStore } = await import(`../src/services/auth/store.ts?${Date.now()}`)

    const delay = authStore.markRateLimited("antigravity", "acc-2", 429, "quota exhausted", "5")
    expect(delay).toBeGreaterThan(0)
    expect(authStore.isRateLimited("antigravity", "acc-2")).toBe(true)

    authStore.markSuccess("antigravity", "acc-2")
    expect(authStore.isRateLimited("antigravity", "acc-2")).toBe(false)

    rmSync(dir, { recursive: true, force: true })
    restoreEnv(prevHome, prevProfile)
})
