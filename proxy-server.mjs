import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = "https://api.deepseek.com/chat/completions";

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url !== "/api/chat" && req.url !== "/chat") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.authorization || "",
    },
    body,
  });
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
    "Access-Control-Allow-Origin": "*",
  });
  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
});

server.listen(PORT, () => {
  console.log(`DeepSeek proxy http://127.0.0.1:${PORT}/api/chat`);
});
