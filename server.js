import express from "express";
import { GoogleGenAI } from "@google/genai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("Warning: GEMINI_API_KEY is not set.");
}

const ai = new GoogleGenAI({
  apiKey,
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
    answer: response.text,
    searchQueries: groundingMetadata?.webSearchQueries || [],
    sources: groundingMetadata?.groundingChunks || [],
  };
}

app.get("/", (req, res) => {
  res.send("Gemini Search MCP server is running.");
});

app.post("/search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        error: "Missing query",
      });
    }

    const result = await runGeminiSearch(query);
    res.json(result);
  } catch (error) {
    console.error("Gemini search failed:", error);

    res.status(500).json({
      error: error.message || "Gemini search failed",
    });
  }
});

function createMcpServer() {
  const server = new McpServer({
    name: "gemini-search-mcp",
    version: "1.0.0",
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
  console.log(`Gemini Search MCP server running on port ${port}`);
});