// api/chat.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || null;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || null;
const MEMORY_TABLE = process.env.SUPABASE_MEMORY_TABLE || "memories";
const MSG_TABLE = process.env.SUPABASE_MSG_TABLE || "messages";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";

const supabase =
  SUPABASE_URL &&
  (SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY));

const EMB_MODEL = "text-embedding-3-small";
const RESP_MODEL = "gpt-4.1-mini";
const TOP_K = 4;

// ================= EMBEDDING =================

async function createEmbedding(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: EMB_MODEL,
      input: text,
    }),
  });

  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return j.data?.[0]?.embedding ?? null;
}

// ================= RESPONSES API =================

async function callResponsesAPI(payload) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  return await r.json();
}

function extractReply(data) {
  if (!data) return null;

  if (typeof data.output_text === "string" && data.output_text.trim())
    return data.output_text.trim();

  const out0 = data.output?.[0];
  if (out0?.content) {
    for (const c of out0.content) {
      if (c?.type === "output_text" && c?.text) return c.text.trim();
    }
  }

  return null;
}

// ================= HANDLER =================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, mode = "reflexiva", persist = true } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Empty message" });
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR");
    const timeStr = now.toLocaleTimeString("pt-BR");

    // ===== Buscar memórias =====
    let memories = [];
    let embedding = null;

    if (supabase) {
      embedding = await createEmbedding(message);

      if (embedding) {
        const rpcResp = await fetch(
          `${SUPABASE_URL}/rpc/match_memories`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
              Authorization: `Bearer ${
                SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY
              }`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query_embedding: embedding,
              match_threshold: 0.0,
              match_count: TOP_K,
            }),
          }
        );

        if (rpcResp.ok) {
          memories = await rpcResp.json();
        }
      }
    }

    // ===== Prompt =====
    const systemPrompt = `
Você é LAILA, assistente privada e estratégica.
Modo: ${mode}
Data atual: ${dateStr}
Hora atual: ${timeStr}
`;

    const payload = {
      model: RESP_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_output_tokens: 700,
      temperature: 0.3,
    };

    const openaiData = await callResponsesAPI(payload);
    const reply = extractReply(openaiData);

    return res.status(200).json({
      reply: reply || "Erro ao gerar resposta.",
      retrieved_count: memories.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error",
      detail: String(err),
    });
  }
}
