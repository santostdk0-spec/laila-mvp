const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4.1-mini";

async function callOpenAI(messages) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: messages,
      max_output_tokens: 500,
      temperature: 0.4
    }),
  });

  const data = await response.json();

  if (data.output_text) return data.output_text;

  return data.output?.[0]?.content?.[0]?.text || "Erro ao gerar resposta.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensagem vazia" });
    }

    const now = new Date();
    const date = now.toLocaleDateString("pt-BR");
    const time = now.toLocaleTimeString("pt-BR");

    const messages = `
Você é LAILA, assistente privada criada por Derick.
Data atual: ${date}
Hora atual: ${time}

Usuário: ${message}
`;

    const reply = await callOpenAI(messages);

    return res.status(200).json({ reply });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro interno" });
  }
}
