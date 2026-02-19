export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Método não permitido" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Mensagem vazia." });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: message
      })
    });

    const data = await response.json();

    const reply = data.output?.[0]?.content?.[0]?.text;

    return res.status(200).json({
      reply: reply || JSON.stringify(data)
    });

  } catch (error) {
    return res.status(500).json({
      reply: "Erro interno: " + error.message
    });
  }
}
