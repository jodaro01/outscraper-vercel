import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const OUTSCRAPER_API_URL = "https://api.outscraper.com";

function getApiKey(): string {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key) throw new Error("OUTSCRAPER_API_KEY environment variable is required");
  return key;
}

async function outscrapeRequest(endpoint: string, params: Record<string, string | number | boolean>): Promise<unknown> {
  const apiKey = getApiKey();
  const url = new URL(`${OUTSCRAPER_API_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));
  
  const response = await fetch(url.toString(), {
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outscraper API error ${response.status}: ${text}`);
  }
  return response.json();
}

function createServer() {
  const server = new McpServer({
    name: "outscraper-mcp",
    version: "1.0.0",
    description: "MCP server for Outscraper - web scraping and data extraction APIs",
  });

  server.tool(
    "google_maps_search",
    "Search for businesses on Google Maps",
    {
      query: z.string().describe("Search query (e.g., 'coffee shops in New York')"),
      limit: z.number().optional().describe("Maximum number of results (default: 10)"),
      language: z.string().optional().describe("Language code (default: en)"),
      region: z.string().optional().describe("Region/country code (e.g., us, de)"),
    },
    async ({ query, limit = 10, language = "en", region = "us" }: any) => {
      const result = await outscrapeRequest("/maps/search-v3", {
        query,
        limit,
        language,
        region,
        async: false,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "google_maps_reviews",
    "Get reviews for a place from Google Maps",
    {
      query: z.string().describe("Place name or Google Maps URL"),
      limit: z.number().optional().describe("Maximum number of reviews (default: 10)"),
      sort: z.string().optional().describe("Sort order: most_relevant, newest, highest_rating, lowest_rating"),
    },
    async ({ query, limit = 10, sort = "most_relevant" }: any) => {
      const result = await outscrapeRequest("/maps/reviews-v3", {
        query,
        reviewsLimit: limit,
        sort,
        async: false,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "google_search",
    "Perform a Google search and get results",
    {
      query: z.string().describe("Search query"),
      pages_per_query: z.number().optional().describe("Number of pages (default: 1)"),
      language: z.string().optional().describe("Language code (default: en)"),
      region: z.string().optional().describe("Region code (default: us)"),
    },
    async ({ query, pages_per_query = 1, language = "en", region = "us" }: any) => {
      const result = await outscrapeRequest("/googlesearch", {
        query,
        pagesPerQuery: pages_per_query,
        language,
        region,
        async: false,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "emails_and_contacts",
    "Extract emails and contacts from websites",
    {
      query: z.string().describe("Website URL or domain to scrape contacts from"),
      limit: z.number().optional().describe("Maximum number of pages to check (default: 1)"),
    },
    async ({ query, limit = 1 }: any) => {
      const result = await outscrapeRequest("/emails-and-contacts", {
        query,
        limit,
        async: false,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "phones_enricher",
    "Enrich phone numbers with carrier and location data",
    {
      query: z.string().describe("Phone number(s) to enrich (comma-separated)"),
    },
    async ({ query }: any) => {
      const result = await outscrapeRequest("/phones-enricher", {
        query,
        async: false,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

const transports: Record<string, SSEServerTransport> = {};

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === "/sse" || url.pathname === "/") {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;
    const server = createServer();
    await server.connect(transport);
    req.on("close", () => { delete transports[sessionId]; });
  } else if (url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !transports[sessionId]) { res.status(400).json({ error: "Invalid sessionId" }); return; }
    await transports[sessionId].handlePostMessage(req, res);
  } else {
    res.status(200).json({
      name: "outscraper-mcp",
      version: "1.0.0",
      description: "Outscraper MCP server - connect via /sse",
      endpoints: { sse: "/sse", messages: "/messages" }
    });
  }
}
