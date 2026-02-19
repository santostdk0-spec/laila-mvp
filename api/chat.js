export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Método não permitido" });
  }

  try {
    const { message } = req.body;

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

    const reply = data.choices?.[0]?.message?.content;

    res.status(200).json({ reply: reply || "Erro ao gerar resposta." });

  } catch (error) {
    res.status(500).json({ reply: "Erro interno no servidor." });
  }
}
