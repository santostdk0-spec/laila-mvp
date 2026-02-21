import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)
// api/chat.js - advanced RAG-enabled chat handler for Vercel
// Requires env:
// OPENAI_API_KEY (required)
// SUPABASE_URL (optional - for memory store)
// SUPABASE_KEY (optional - anon or service_role to write)
// SUPABASE_MEMORY_TABLE (optional, default 'memories')

/*
 Behavior:
 - If Supabase not configured, acts as a plain chat proxy to OpenAI.
 - If Supabase configured, will:
   1) create embedding for the incoming message,
   2) query similar memories via RPC /rpc/match_memories (recommended) or fallback,
   3) include topK memories in the system prompt,
   4) call Responses API,
   5) persist a short memory snippet (if persist=true).
*/

const TOP_K = 4;
const EMBEDDING_MODEL = "text-embedding-3-small";
const RESPONSE_MODEL = "gpt-4.1-mini";

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

// robust extraction for Responses API
function extractReplyFromResponses(resp) {
  if (!resp) return null;
  if (typeof resp.output_text === "string" && resp.output_text.trim()) return resp.output_text.trim();

  const out0 = resp.output?.[0];
  if (out0) {
    // common shape: output[0].content -> array of blocks
    if (Array.isArray(out0.content)) {
      // prefer output_text type
      for (const c of out0.content) {
        if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) return c.text.trim();
      }
      // fallback: first content block with text
      for (const c of out0.content) {
        if (typeof c?.text === "string" && c.text.trim()) return c.text.trim();
      }
    }
    // some responses include text field directly
    if (typeof out0.text === "string" && out0.text.trim()) return out0.text.trim();
  }

  // older style choices
  if (Array.isArray(resp.choices) && resp.choices[0]?.message?.content) {
    const msg = resp.choices[0].message.content;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    if (msg?.text) return String(msg.text).trim();
  }

  return null;
}

async function createEmbedding(openaiKey, text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text })
  });
  if (!r.ok) {
    const t = await r.text().catch(()=>null);
    throw new Error("Embedding error: " + (t || r.status));
  }
  const j = await r.json();
  return j.data?.[0]?.embedding ?? null;
}

async function supabaseQuery(similarityEndpoint, supabaseKey, embedding, topK=TOP_K) {
  // Prefers /rpc/match_memories (RPC implemented in Supabase SQL)
  try {
    const rpcUrl = `${similarityEndpoint}/rpc/match_memories`;
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.0, match_count: topK })
    });
    if (!resp.ok) {
      // fallback to restful query
      const txt = await resp.text().catch(()=>null);
      throw new Error("Supabase RPC error: " + (txt || resp.status));
    }
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // Fallback: try simple full-text search (limited). Return empty gracefully.
    console.warn("supabaseQuery RPC failed:", e.message || e);
    return [];
  }
}

async function supabaseInsertMemory(restUrl, supabaseKey, table, id, content, embedding) {
  try {
    const url = `${restUrl}/rest/v1/${table}`;
    const body = { id, content, embedding };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=>null);
      console.warn("supabase insert failed:", resp.status, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("supabaseInsertMemory error:", e);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const message = (body.message || body.prompt || "").toString();
    const mode = (body.mode || "reflexiva").toString();
    const persist = body.persist === undefined ? true : !!body.persist; // default true

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Mensagem vazia" });
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return res.status(500).json({ error: "OpenAI API key not configured" });

    // Optional Supabase config
    const SUPABASE_URL = process.env.SUPABASE_URL || null;
    const SUPABASE_KEY = process.env.SUPABASE_KEY || null;
    const MEMORY_TABLE = process.env.SUPABASE_MEMORY_TABLE || "memories";

    // 1) If supabase present -> create embedding and query similar memories
    let memories = [];
    let embedding = null;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        embedding = await createEmbedding(OPENAI_KEY, message);
        if (embedding) {
          memories = await supabaseQuery(SUPABASE_URL, SUPABASE_KEY, embedding, TOP_K);
        }
      } catch (e) {
        console.warn("Memory retrieval error:", e.message || e);
        // continue silently — we still can answer
      }
    }

    // Build system prompt with persona, mode and retrieved memories
    const persona = `Você é LAILA, assistente privada, inteligente, estratégica e leal ao seu criador Derick. Modo: ${mode}. Seja preciso, cite fontes se usar informações externas. Se não souber algo em tempo real, diga claramente.`;
    let memoryText = "";
    if (Array.isArray(memories) && memories.length > 0) {
      // memories expected to have 'content' and optional 'source' and 'created_at'
      const lines = memories.map((m, i) => {
        const content = (m.content || m.text || m.value || "").toString();
        const src = m.source ? ` (src: ${m.source})` : "";
        return `${i+1}. ${content}${src}`;
      });
      memoryText = `Memórias relevantes encontradas:\n${lines.join("\n")}\n\n`;
    }

    // Compose input for Responses API
    const systemBlock = { role: "system", content: persona + "\n\n" + (memoryText || "") };
    const userBlock = { role: "user", content: message };

    const payload = {
      model: RESPONSE_MODEL,
      input: [systemBlock, userBlock],
      max_output_tokens: 700,
      temperature: 0.3
    };

    // Call Responses API
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(()=>null);
    console.log("OpenAI responses raw:", JSON.stringify(data));

    // Extract reply robustly
    const reply = extractReplyFromResponses(data);

    // Save memory if requested and supabase present
    let saved = false;
    if (persist && SUPABASE_URL && SUPABASE_KEY && embedding) {
      try {
        // keep memory snippet short
        const snippet = message.length > 800 ? message.slice(0,800) : message;
        const id = `${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
        saved = await supabaseInsertMemory(SUPABASE_URL, SUPABASE_KEY, MEMORY_TABLE, id, snippet, embedding);
      } catch (e) {
        console.warn("Failed to persist memory:", e.message || e);
      }
    }

    // If no reply extracted, include debug for frontend
    if (!reply) {
      return res.status(200).json({ reply: null, debug: data || "no-data" });
    }

    // Return
    return res.status(200).json({
      reply,
      retrieved_count: Array.isArray(memories) ? memories.length : 0,
      memory_saved: saved
    });

  } catch (err) {
    console.error("chat handler fatal:", err);
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
