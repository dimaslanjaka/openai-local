import { Hono } from "hono"
import { isLoopbackHost } from "~/lib/local-request"
import { applyUpdate, checkForUpdates } from "~/services/updates"

export const updatesRouter = new Hono()

updatesRouter.use(async (c, next) => {
    if (!isLoopbackHost(c.req.header("host"))) {
        return c.json({ success: false, error: "Updates are only available from localhost." }, 403)
    }
    await next()
})

updatesRouter.get("/check", async (c) => {
    try {
        const result = await checkForUpdates(true)
        return c.json({ success: true, ...result })
    } catch (error) {
        return c.json({ success: false, error: (error as Error).message }, 500)
    }
})

updatesRouter.post("/apply", async (c) => {
    try {
        const result = await applyUpdate()
        return c.json({ success: true, ...result })
    } catch (error) {
        return c.json({ success: false, error: (error as Error).message }, 500)
    }
})
