<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Laila IA</title>

<style>
body {
  margin: 0;
  background: #0a0f1c;
  font-family: 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
  height: 100vh;
  color: white;
}

#chat {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.message {
  padding: 12px 15px;
  border-radius: 15px;
  margin-bottom: 10px;
  max-width: 70%;
  animation: fadeIn 0.3s ease-in-out;
}

.user {
  background: #2563eb;
  align-self: flex-end;
}

.bot {
  background: #111827;
  border: 1px solid #00f7ff;
  box-shadow: 0 0 10px #00f7ff44;
  align-self: flex-start;
}

#inputArea {
  display: flex;
  padding: 15px;
  background: #111827;
}

input {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  border: none;
  outline: none;
  background: #1f2937;
  color: white;
}

button {
  margin-left: 10px;
  padding: 12px 20px;
  border: none;
  border-radius: 10px;
  background: #00f7ff;
  cursor: pointer;
  font-weight: bold;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
</head>

<body>

<div id="chat"></div>

<div id="inputArea">
  <input id="input" placeholder="Digite sua mensagem..." />
  <button onclick="sendMessage()">Enviar</button>
</div>

<script>
async function sendMessage() {
  const input = document.getElementById("input");
  const chat = document.getElementById("chat");
  const text = input.value;
  if (!text) return;

  chat.innerHTML += `<div class="message user">${text}</div>`;
  input.value = "";
  chat.scrollTop = chat.scrollHeight;

  const loading = document.createElement("div");
  loading.className = "message bot";
  loading.innerText = "Digitando...";
  chat.appendChild(loading);
  chat.scrollTop = chat.scrollHeight;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text })
  });

  const data = await response.json();

  loading.remove();

  typeEffect(data.reply, chat);
}

function typeEffect(text, chat) {
  const msg = document.createElement("div");
  msg.className = "message bot";
  chat.appendChild(msg);

  let i = 0;
  const interval = setInterval(() => {
    msg.innerHTML += text.charAt(i);
    i++;
    chat.scrollTop = chat.scrollHeight;
    if (i >= text.length) clearInterval(interval);
  }, 20);
}
</script>

</body>
</html>
