export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Método não permitido" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Mensagem vazia." });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é Laila, uma IA estratégica, inteligente e direta." },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();

    console.log(data); // ajuda a debug se der erro

    const reply = data?.choices?.[0]?.message?.content;

    return res.status(200).json({
      reply: reply || "A IA não retornou resposta."
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      reply: "Erro interno no servidor."
    });
  }
}
