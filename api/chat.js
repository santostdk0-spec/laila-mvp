export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const prompt = body.prompt || '';

    const OPENAI_KEY = process.env.OPENAI_KEY;
    if (!OPENAI_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured.' });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Você é Laila, uma IA inteligente, estratégica e adaptável. Responda com personalidade forte e clareza." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "Erro ao gerar resposta.";

    return res.status(200).json({ text });

  } catch (error) {
    return res.status(500).json({ error: "Erro interno", detail: String(error) });
  }
}
