import express from "express"
import { randomUUID } from "node:crypto"

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    InitializeRequestSchema
} from "@modelcontextprotocol/sdk/types.js"

const PORT = process.env.PORT || 3000
const BASE_URL = process.env.BASE_URL // e.g. https://yourdomain/.../endpoint-REST

if (!BASE_URL) {
    console.error("Missing BASE_URL env var")
    process.exit(1)
}

async function httpGetJson(url) {
    const res = await fetch(url)
    const text = await res.text()

    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`)
        err.status = res.status
        err.data = data
        throw err
    }
    return data
}

// MCP logic (tools)
const mcp = new Server(
    { name: "ai-test-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        { name: "ping_bridge", description: "Call /ping", inputSchema: { type: "object", properties: {} } },
        {
            name: "get_product",
            description: "Get product by SKU",
            inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] }
        },
        {
            name: "get_price",
            description: "Get price by SKU",
            inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] }
        }
    ]
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const args = req.params.arguments ?? {}

    try {
        if (name === "ping_bridge") {
            const data = await httpGetJson(`${BASE_URL}/ping`)
            return { content: [{ type: "text", text: JSON.stringify(data) }] }
        }

        if (name === "get_product") {
            const sku = args.sku
            if (!sku) throw new Error("Missing argument: sku")
            const data = await httpGetJson(`${BASE_URL}/products/${encodeURIComponent(sku)}`)
            return { content: [{ type: "text", text: JSON.stringify(data) }] }
        }

        if (name === "get_price") {
            const sku = args.sku
            if (!sku) throw new Error("Missing argument: sku")
            const data = await httpGetJson(`${BASE_URL}/prices/${encodeURIComponent(sku)}`)
            return { content: [{ type: "text", text: JSON.stringify(data) }] }
        }

        throw new Error(`Unknown tool: ${name}`)
    } catch (e) {
        return {
            content: [
                { type: "text", text: JSON.stringify({ ok: false, error: e.message, details: e.data ?? null }) }
            ]
        }
    }
})

// ---- Streamable HTTP transport wiring (stateful sessions) ----
const SESSION_HEADER = "mcp-session-id"
const transports = new Map() // sessionId -> transport

function isInitialize(body) {
    const isInit = (x) => InitializeRequestSchema.safeParse(x).success
    return Array.isArray(body) ? body.some(isInit) : isInit(body)
}

const app = express()
app.use(express.json({ limit: "2mb" }))

// MCP endpoint: POST /
app.post("/", async (req, res) => {
    const sessionId = req.header(SESSION_HEADER) || undefined

    try {
        // reuse session transport
        if (sessionId && transports.has(sessionId)) {
            const transport = transports.get(sessionId)
            await transport.handleRequest(req, res, req.body)
            return
        }

        // create new transport on initialize
        if (!sessionId && isInitialize(req.body)) {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID()
                // stateless alternative:
                // sessionIdGenerator: () => undefined
            })

            await mcp.connect(transport)
            await transport.handleRequest(req, res, req.body)

            if (transport.sessionId) transports.set(transport.sessionId, transport)
            return
        }

        res.status(400).json({ ok: false, error: "Bad Request: missing/invalid session or initialize first" })
    } catch (err) {
        console.error(err)
        res.status(500).json({ ok: false, error: "Internal server error" })
    }
})

// MCP endpoint: GET / (optional SSE). We keep it simple: 405.
app.get("/", (req, res) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed")
})

app.listen(PORT, () => {
    console.log(`MCP HTTP server listening on port ${PORT}`)
})
