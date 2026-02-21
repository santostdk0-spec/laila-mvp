// api/chat.js
import { createClient } from "@supabase/supabase-js";

/*
  Backend robusto:
  - usa OpenAI Responses API + Embeddings
  - opcionalmente consulta e persiste memórias em Supabase
  - retorna { reply, retrieved_count, memory_saved }
*/

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || null;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || null;

const MEMORY_TABLE = process.env.SUPABASE_MEMORY_TABLE || "memories";
const MSG_TABLE = process.env.SUPABASE_MSG_TABLE || "messages";

const RESP_MODEL = "gpt-4.1-mini";
const EMB_MODEL = "text-embedding-3-small";
const TOP_K = 4; // quantas memórias recuperar

const supabase =
  SUPABASE_URL && (SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY));

// ---------------- helpers ----------------

async function createEmbedding(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: EMB_MODEL, input: text }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Embedding error: ${res.status} ${t}`);
  }
  const j = await res.json();
  return j?.data?.[0]?.embedding ?? null;
}

function extractReplyFromResponses(data) {
  if (!data) return null;
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const out0 = data.output?.[0];
  if (out0?.content && Array.isArray(out0.content)) {
    for (const c of out0.content) {
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) return c.text.trim();
    }
    for (const c of out0.content) {
      if (typeof c?.text === "string" && c.text.trim()) return c.text.trim();
    }
  }
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    const msg = data.choices[0].message.content;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    if (msg?.text) return String(msg.text).trim();
  }
  return null;
}

async function callResponsesAPI(payload) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  return j;
}

// ---------------- handler ----------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = (body.message || "").toString();
    const mode = (body.mode || "reflexiva").toString();
    const persist = body.persist === undefined ? true : !!body.persist;

    if (!message || message.trim().length === 0) return res.status(400).json({ error: "Empty message" });
    if (!OPENAI_KEY) return res.status(500).json({ error: "OpenAI key not configured" });

    // add current date/time to prompt (user requested)
    const now = new Date();
    const dateStr = now.toLocaleDateString("pt-BR");
    const timeStr = now.toLocaleTimeString("pt-BR");

    // 1) If Supabase configured, compute embedding + fetch top-K memories (RPC)
    let memories = [];
    let embedding = null;
    if (supabase) {
      try {
        embedding = await createEmbedding(message);
        if (embedding) {
          // prefer RPC match_memories created in Supabase schema
          try {
            const rpcResult = await supabase.rpc("match_memories", {
              query_embedding: embedding,
              match_threshold: 0.0,
              match_count: TOP_K,
            });
            // supabase.rpc returns { data, error } shape via client lib, but sometimes returns array directly; normalize:
            if (rpcResult?.data) memories = rpcResult.data;
            else if (Array.isArray(rpcResult)) memories = rpcResult;
            else if (rpcResult) memories = rpcResult;
          } catch (eRpc) {
            // fallback: call REST RPC endpoint if needed
            try {
              const rpcUrl = `${SUPABASE_URL}/rpc/match_memories`;
              const fetchRpc = await fetch(rpcUrl, {
                method: "POST",
                headers: {
                  apikey: SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.0, match_count: TOP_K }),
              });
              if (fetchRpc.ok) {
                memories = await fetchRpc.json();
              }
            } catch (inner) {
              console.warn("rpc fallback failed", inner);
            }
          }
        }
      } catch (e) {
        console.warn("memory retrieval error", e);
        // continue without memories
      }
    }

    // 2) build system prompt including time and top memories
    let systemContent = `Você é LAILA, assistente privada, estratégica e leal ao seu criador. Modo: ${mode}.\nData: ${dateStr}\nHora: ${timeStr}\nSeja objetivo e cite fontes/timestamps quando usar dados externos.\n`;

    if (Array.isArray(memories) && memories.length > 0) {
      const memText = memories
        .map((m, i) => `${i + 1}. ${m.content || m.description || ""}${m.metadata ? ` (meta: ${JSON.stringify(m.metadata)})` : ""}`)
        .join("\n");
      systemContent += `\nMemórias relevantes:\n${memText}\n\n`;
    }

    const payload = {
      model: RESP_MODEL,
      input: [
        { role: "system", content: systemContent },
        { role: "user", content: message },
      ],
      max_output_tokens: 800,
      temperature: 0.35,
    };

    // 3) call Responses API
    const openaiResp = await callResponsesAPI(payload);
    const reply = extractReplyFromResponses(openaiResp) || null;

    // 4) persist audit message in messages table (if supabase configured)
    let savedAudit = false;
    if (supabase) {
      try {
        await supabase.from(MSG_TABLE).insert([{ user_message: message, bot_reply: reply || JSON.stringify(openaiResp).slice(0, 1200) }]);
        savedAudit = true;
      } catch (e) {
        console.warn("audit save failed", e);
      }
    }

    // 5) persist semantic memory if requested
    let savedMemory = false;
    if (persist && supabase && embedding) {
      try {
        const snippet = message.length > 800 ? message.slice(0, 800) : message;
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const meta = { mode, created_by: "user", created_at: new Date().toISOString() };
        // insert via supabase client (embedding must match column type in schema)
        const insertResp = await supabase.from(MEMORY_TABLE).insert([{ id, content: snippet, metadata: meta, embedding }]);
        if (!insertResp.error) savedMemory = true;
      } catch (e) {
        console.warn("memory persist failed", e);
      }
    }

    return res.status(200).json({
      reply,
      retrieved_count: Array.isArray(memories) ? memories.length : 0,
      memory_saved: savedMemory,
      audit_saved: savedAudit,
    });
  } catch (err) {
    console.error("chat handler error", err);
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
