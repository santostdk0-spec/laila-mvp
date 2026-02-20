// api/chat.js
// Vercel Serverless function — proxy para OpenAI Responses API
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const message = body.message || body.prompt || "";
    const mode = body.mode || "reflexiva";

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Mensagem vazia" });
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) {
      console.error("OPENAI_API_KEY missing");
      return res.status(500).json({ error: "API key não configurada no servidor" });
    }

    // Monta prompt / contexto básico (personalidade)
    const systemPrompt = [
      { role: "system", content: `Você é LAILA, uma assistente privada extremamente inteligente, estratégica e leal ao seu criador Derick. Modo: ${mode}. Responda com clareza, cite fontes quando disponível.` },
      { role: "user", content: message }
    ];

    const payload = {
      model: "gpt-4.1-mini",
      input: systemPrompt,
      // control params
      max_output_tokens: 600,
      temperature: 0.7
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // Log completo para debug (Vercel logs)
    console.log("OpenAI responses raw:", JSON.stringify(data));

    // Extrair texto de resposta de forma segura (vários formatos possíveis)
    function extractText(resp) {
      if (!resp) return null;
      // 1) output_text (compat)
      if (typeof resp.output_text === "string" && resp.output_text.trim()) return resp.output_text.trim();

      // 2) output array content -> first block -> text
      const out0 = resp.output?.[0];
      if (out0) {
        // case: content is array of chunks
        const c0 = out0.content?.[0];
        if (c0 && typeof c0.text === "string" && c0.text.trim()) return c0.text.trim();

        // fallback: search content array for type 'output_text'
        if (Array.isArray(out0.content)) {
          for (const c of out0.content) {
            if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) return c.text.trim();
          }
        }
      }

      // 3) choices style (older)
      if (Array.isArray(resp.choices) && resp.choices[0]?.message?.content) {
        const msg = resp.choices[0].message.content;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
        // if content object
        if (msg?.text) return String(msg.text).trim();
      }

      return null;
    }

    const replyText = extractText(data);

    if (!replyText) {
      // se não extraiu texto, retorna o objeto inteiro pra ajudar no debug do frontend (será mostrado como texto)
      return res.status(200).json({ reply: null, debug: data });
    }

    return res.status(200).json({ reply: replyText });
  } catch (error) {
    console.error("chat handler error:", error);
    return res.status(500).json({ error: "Erro interno no servidor", detail: String(error) });
  }
}
