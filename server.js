import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js"

//const BASE_URL = "http://192.168.86.202/TEST-CORSI/TEST/AI-agentKit-mcp-endpoint/endpoint-REST"
const BASE_URL = "https://ai-test.vegstaging.com"

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

const server = new Server(
    { name: "ai-test-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } }
)

// 1) expose tools list
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "ping_bridge",
                description: "Call /ping and return JSON",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "get_product",
                description: "Get product by SKU",
                inputSchema: {
                    type: "object",
                    properties: { sku: { type: "string" } },
                    required: ["sku"]
                }
            },
            {
                name: "get_price",
                description: "Get price by SKU",
                inputSchema: {
                    type: "object",
                    properties: { sku: { type: "string" } },
                    required: ["sku"]
                }
            }
        ]
    }
})

// 2) handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const args = request.params.arguments ?? {}

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

const transport = new StdioServerTransport()
await server.connect(transport)
