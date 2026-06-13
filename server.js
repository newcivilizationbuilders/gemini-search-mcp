import express from "express";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("Warning: GEMINI_API_KEY is not set.");
}

const ai = new GoogleGenAI({
  apiKey,
});

app.get("/", (req, res) => {
  res.send("Gemini Search server is running.");
});

app.post("/search", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        error: "Missing query",
      });
    }

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

    res.json({
      answer: response.text,
      searchQueries: groundingMetadata?.webSearchQueries || [],
      sources: groundingMetadata?.groundingChunks || [],
    });
  } catch (error) {
    console.error("Gemini search failed:", error);

    res.status(500).json({
      error: error.message || "Gemini search failed",
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Gemini Search server running on port ${port}`);
});