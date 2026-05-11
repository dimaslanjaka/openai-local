export function isLoopbackHost(host: string | undefined): boolean {
    if (!host) return true
    const hostname = host.replace(/:\d+$/, "").toLowerCase()
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
}
