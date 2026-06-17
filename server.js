import express from "express";
import { GoogleGenAI } from "@google/genai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const geminiApiKey = process.env.GEMINI_API_KEY;
const xaiApiKey = process.env.XAI_API_KEY;

if (!geminiApiKey) {
  console.warn("Warning: GEMINI_API_KEY is not set.");
}

if (!xaiApiKey) {
  console.warn("Warning: XAI_API_KEY is not set.");
}

const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
});

async function runGeminiSearch(query) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: query,
    config: {
      tools: [
        {
          googleSearch: {},
        },
      ],
    },
  });

  const groundingMetadata =
    response?.candidates?.[0]?.groundingMetadata || null;

  return {
    provider: "gemini",
    answer: response.text,
    searchQueries: groundingMetadata?.webSearchQueries || [],
    sources: groundingMetadata?.groundingChunks || [],
  };
}

async function runGrokWebSearch(query) {
  if (!xaiApiKey) {
    throw new Error("XAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4.3",
      instructions:
        "You are a research assistant. Use live web search when helpful. Return a concise answer with useful source links where available.",
      input: [
        {
          role: "user",
          content: query,
        },
      ],
      tools: [
        {
          type: "web_search",
        },
      ],
    }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`xAI API returned non-JSON: ${rawText.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  const answer =
    data.output
      ?.flatMap((o) => o.content || [])
      ?.filter((c) => c.type === "output_text")
      ?.map((c) => c.text)
      ?.join("") || "";

  return {
    provider: "grok",
    answer,
    citations: data.citations || [],
    raw: data,
  };
}

async function runGrokXSearch(query) {
  if (!xaiApiKey) {
    throw new Error("XAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4.3",
      instructions:
        "You are a social media intelligence assistant. Use X search to find current posts, sentiment, angles, competitors, objections, and trend language. Return concise insights with links where available.",
      input: [
        {
          role: "user",
          content: query,
        },
      ],
      tools: [
        {
          type: "x_search",
        },
      ],
    }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`xAI API returned non-JSON: ${rawText.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  const answer =
    data.output
      ?.flatMap((o) => o.content || [])
      ?.filter((c) => c.type === "output_text")
      ?.map((c) => c.text)
      ?.join("") || "";

  return {
    provider: "grok_x",
    answer,
    citations: data.citations || [],
    raw: data,
  };
}

app.get("/", (req, res) => {
  res.send("Gemini + Grok MCP server is running.");
});

app.post("/search", async (req, res) => {
  try {
    const { query, provider = "gemini" } = req.body;

    if (!query) {
      return res.status(400).json({
        error: "Missing query",
      });
    }

    let result;

    if (provider === "grok") {
      result = await runGrokWebSearch(query);
    } else if (provider === "grok_x") {
      result = await runGrokXSearch(query);
    } else {
      result = await runGeminiSearch(query);
    }

    res.json(result);
  } catch (error) {
    console.error("Search failed:", error);

    res.status(500).json({
      error: error.message || "Search failed",
    });
  }
});

function createMcpServer() {
  const server = new McpServer({
    name: "gemini-grok-search-mcp",
    version: "1.1.0",
  });

  server.registerTool(
    "gemini_web_search",
    {
      title: "Gemini Web Search",
      description:
        "Search the live web using Gemini with Google Search grounding. Use this for current facts, regulations, pricing, news, tenders, competitor research, compliance updates, and anything that may have changed recently.",
      inputSchema: {
        query: z.string().describe("The web search query to send to Gemini."),
      },
    },
    async ({ query }) => {
      const result = await runGeminiSearch(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "grok_web_search",
    {
      title: "Grok Web Search",
      description:
        "Search the live web using Grok/xAI. Use this for fresh public information, fast research, market chatter, competitor updates, and current events.",
      inputSchema: {
        query: z.string().describe("The web search query to send to Grok."),
      },
    },
    async ({ query }) => {
      const result = await runGrokWebSearch(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "grok_x_search",
    {
      title: "Grok X Search",
      description:
        "Search X/Twitter using Grok. Use this for social media trends, competitor chatter, ad angles, audience objections, sentiment, and viral language.",
      inputSchema: {
        query: z
          .string()
          .describe("The X/Twitter search or social research query to send to Grok."),
      },
    },
    async ({ query }) => {
      const result = await runGrokXSearch(query);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || "MCP request failed",
      });
    }
  }
});

app.get("/mcp", (req, res) => {
  res.status(405).json({
    error: "Method not allowed. Use POST for MCP requests.",
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Gemini + Grok MCP server running on port ${port}`);
});