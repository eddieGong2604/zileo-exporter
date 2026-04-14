const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";

type OpenAIResponsesError = { error?: { message?: string } };

export type RevealCompanyPayload = {
  companySize: string;
  isHeadhunt: boolean;
  isOutsource: boolean;
};

function extractResponsesOutputText(data: Record<string, unknown>): string {
  const output = data.output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (o.type === "message" && Array.isArray(o.content)) {
      for (const part of o.content) {
        if (typeof part !== "object" || part === null) continue;
        const p = part as Record<string, unknown>;
        if (p.type === "output_text" && typeof p.text === "string") {
          return p.text;
        }
      }
    }
  }
  return "";
}

function parseRevealJson(text: string): RevealCompanyPayload {
  const trimmed = text.trim();
  if (!trimmed) {
    return { companySize: "—", isHeadhunt: false, isOutsource: false };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      companySize:
        typeof parsed.companySize === "string" && parsed.companySize.trim()
          ? parsed.companySize.trim()
          : "Unknown",
      isHeadhunt: Boolean(parsed.isHeadhunt),
      isOutsource: Boolean(parsed.isOutsource),
    };
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as Record<string, unknown>;
        return {
          companySize:
            typeof parsed.companySize === "string" && parsed.companySize.trim()
              ? parsed.companySize.trim()
              : "Unknown",
          isHeadhunt: Boolean(parsed.isHeadhunt),
          isOutsource: Boolean(parsed.isOutsource),
        };
      } catch {
        /* fall through */
      }
    }
    return { companySize: "—", isHeadhunt: false, isOutsource: false };
  }
}

export async function revealCompanyWithOpenAI(opts: {
  companyName: string;
  countryHint?: string;
  apiKey: string;
}): Promise<RevealCompanyPayload> {
  const { companyName, countryHint, apiKey } = opts;
  const userPrompt = `Company: "${companyName}"${
    countryHint ? `\nGeographic context (hint): ${countryHint}` : ""
  }

Use web search to find this organization's approximate employee count / company size (e.g. LinkedIn ranges like 1-10, 11-50, 51-200) and classify:
- isHeadhunt: true if it is primarily a recruitment agency, executive search, or headhunting firm placing candidates at client companies.
- isOutsource: true if it is primarily IT outsourcing, staff augmentation, body shop, or dedicated nearshore/offshore delivery for clients.

Respond with JSON only (no markdown) matching the schema. Use "Unknown" for companySize if unclear.`;

  const jsonSchemaPayload = {
    model: "gpt-4o",
    input: userPrompt,
    tools: [{ type: "web_search" as const }],
    tool_choice: "auto" as const,
    text: {
      format: {
        type: "json_schema" as const,
        name: "company_reveal",
        strict: true as const,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["companySize", "isHeadhunt", "isOutsource"],
          properties: {
            companySize: { type: "string" },
            isHeadhunt: { type: "boolean" },
            isOutsource: { type: "boolean" },
          },
        },
      },
    },
  };

  let upstream = await fetch(OPENAI_RESPONSES, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jsonSchemaPayload),
  });

  let raw: unknown = await upstream.json();

  if (!upstream.ok) {
    const fallbackPayload = {
      model: "gpt-4o",
      input: `${userPrompt}\n\nReturn a single JSON object with keys companySize (string), isHeadhunt (boolean), isOutsource (boolean). No markdown.`,
      tools: [{ type: "web_search" as const }],
      tool_choice: "auto" as const,
    };
    upstream = await fetch(OPENAI_RESPONSES, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fallbackPayload),
    });
    raw = await upstream.json();
  }

  if (!upstream.ok) {
    const err = raw as OpenAIResponsesError;
    const msg = err.error?.message ?? `OpenAI HTTP ${upstream.status}`;
    throw new Error(msg);
  }

  const data = raw as Record<string, unknown>;
  const text = extractResponsesOutputText(data);
  return parseRevealJson(text);
}
