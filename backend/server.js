const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "db.json");

function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile();

const port = Number(process.env.PORT || 8040);
const whatsappConfig = {
  provider: process.env.WHATSAPP_PROVIDER || "zapi",
  zapiInstanceId: process.env.ZAPI_INSTANCE_ID || "",
  zapiToken: process.env.ZAPI_TOKEN || "",
  zapiClientToken: process.env.ZAPI_CLIENT_TOKEN || "",
  senderTestPhone: process.env.WHATSAPP_REMETENTE_TESTE || "5561993126544",
  nubiaPhone: process.env.WHATSAPP_NUBIA || "5561993126544"
};
const markets = ["Atacadão DIA-A-DIA", "Super Adega Atacadista", "Vivendas", "Tatico"];
const marketSources = [
  {
    mercado: "Atacadão DIA-A-DIA",
    urls: [
      "https://www.diaadia.com.br/ofertas",
      "https://www.diaadia.com.br/encarte",
      "https://www.atacadaodiaadia.com.br/ofertas"
    ]
  },
  {
    mercado: "Super Adega Atacadista",
    urls: [
      "https://www.superadega.com.br/ofertas",
      "https://www.superadega.com.br/encarte",
      "https://www.superadegaatacadista.com.br/ofertas"
    ]
  },
  {
    mercado: "Vivendas",
    urls: [
      "https://www.vivendas.com.br/ofertas",
      "https://www.vivendas.com.br/encarte",
      "https://www.supermercadovivendas.com.br/ofertas"
    ]
  },
  {
    mercado: "Tatico",
    urls: [
      "https://www.tatico.com.br/ofertas",
      "https://www.tatico.com.br/encarte",
      "https://www.supermercadotatico.com.br/ofertas"
    ]
  }
];
const monitoredItems = [
  "peito de frango",
  "patinho",
  "acém",
  "carne moída",
  "tomate",
  "batata",
  "cenoura",
  "alface",
  "couve",
  "cebola",
  "arroz",
  "feijão"
];
const monitoredRegions = ["Recanto das Emas", "Riacho Fundo I", "Riacho Fundo II"];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ data: {}, updatedAt: new Date().toISOString() }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify({ ...db, updatedAt: new Date().toISOString() }, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Payload muito grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function getState() {
  const db = readDb();
  db.data = db.data || {};
  db.data.pedidos = db.data.pedidos || [];
  return db;
}

function updateState(mutator) {
  const db = getState();
  mutator(db.data);
  writeDb(db);
  return db;
}

function whatsappReady() {
  return Boolean(whatsappConfig.zapiInstanceId && whatsappConfig.zapiToken && whatsappConfig.zapiClientToken);
}

async function sendWhatsAppMessage(phone, message) {
  const cleanPhone = onlyDigits(phone);
  if (!whatsappReady()) {
    return {
      sent: false,
      reason: "Configure ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_CLIENT_TOKEN no backend."
    };
  }

  const body = JSON.stringify({
    phone: cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`,
    message
  });
  const response = await postJsonHttps({
    hostname: "api.z-api.io",
    path: `/instances/${whatsappConfig.zapiInstanceId}/token/${whatsappConfig.zapiToken}/send-text`,
    headers: whatsappConfig.zapiClientToken ? { "Client-Token": whatsappConfig.zapiClientToken } : {}
  }, body);

  return {
    sent: response.status >= 200 && response.status < 300,
    status: response.status,
    body: response.body
  };
}

function postJsonHttps(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: options.hostname,
      path: options.path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...options.headers
      },
      timeout: 30000
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: responseBody });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Tempo esgotado ao chamar a Z-API."));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractWebhookMessage(payload) {
  const text = payload.text?.message || payload.message?.text || payload.body || payload.text || payload.message || "";
  const phone = payload.phone || payload.from || payload.sender?.phone || payload.sender || payload.participantPhone || "";
  return {
    text: String(text || "").trim(),
    phone: onlyDigits(phone)
  };
}

function latestPendingCustomerOrder(data) {
  return [...(data.pedidos || [])]
    .filter((pedido) => pedido.origem === "Loja do cliente" && !pedido.aceitoEm && pedido.status !== "Recusado")
    .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))[0] || null;
}

async function applyWhatsAppDecision(decision) {
  const accepted = decision === "1";
  const refused = decision === "2";
  if (!accepted && !refused) {
    return { ok: false, reason: "Resposta ignorada. Use 1 para aceitar ou 2 para recusar." };
  }

  let changedOrder = null;
  updateState((data) => {
    const pending = latestPendingCustomerOrder(data);
    if (!pending) return;
    data.pedidos = data.pedidos.map((pedido) => {
      if (pedido.id !== pending.id) return pedido;
      changedOrder = {
        ...pedido,
        status: accepted ? "Pago" : "Recusado",
        statusEntrega: accepted ? "Preparando" : "Recusado",
        aceitoEm: accepted ? new Date().toISOString() : pedido.aceitoEm,
        recusadoEm: refused ? new Date().toISOString() : pedido.recusadoEm
      };
      return changedOrder;
    });
  });

  if (!changedOrder) {
    return { ok: false, reason: "Nenhum pedido novo aguardando confirmação." };
  }

  const customerMessage = accepted
    ? `Olá, ${changedOrder.cliente}! A Núbia aceitou seu pedido. Sua marmita já entrou na fila de preparo.`
    : `Olá, ${changedOrder.cliente}! A Núbia não conseguiu aceitar esse pedido no momento. Pode chamar por aqui para ajustar a encomenda?`;

  const notification = changedOrder.telefone
    ? await sendWhatsAppMessage(changedOrder.telefone, customerMessage).catch((error) => ({ sent: false, error: error.message }))
    : { sent: false, reason: "Cliente sem telefone." };

  return { ok: true, accepted, refused, order: changedOrder, customerNotification: notification };
}

function extractPrices(text) {
  const matches = String(text || "").match(/R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
  return [...new Set(matches)].slice(0, 5);
}

function cleanText(text) {
  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function priceToNumber(value) {
  if (!value) return 0;
  return Number(String(value).replace("R$", "").replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MarmitasDaNubia/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6"
      }
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

function extractDailyDeals(html, source, items) {
  const plain = cleanText(html);
  const priceRegex = /R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const deals = [];
  let match;

  while ((match = priceRegex.exec(plain)) !== null) {
    const priceRaw = match[0];
    const start = Math.max(0, match.index - 150);
    const end = Math.min(plain.length, match.index + 170);
    const context = plain.slice(start, end).trim();
    const normalizedContext = normalizeText(context);
    const matchedItem = items.find((item) => normalizedContext.includes(normalizeText(item)));
    const descricao = context.replace(/\s+/g, " ").slice(0, 180).trim();

    deals.push({
      mercado: source.mercado,
      item: matchedItem || "Oferta do dia",
      descricao: descricao || `${source.mercado} - ${priceRaw}`,
      priceRaw,
      priceValue: priceToNumber(priceRaw),
      sourceUrl: source.url,
      capturedAt: new Date().toISOString(),
      confidence: matchedItem ? "alta" : "media"
    });
  }

  return deals
    .filter((deal) => deal.priceValue > 0)
    .sort((a, b) => a.priceValue - b.priceValue)
    .slice(0, 20);
}

async function scanMarketSource(source, items) {
  const attempts = [];
  const deals = [];

  for (const url of source.urls) {
    const attempt = { mercado: source.mercado, url, ok: false, status: null, count: 0 };
    try {
      const response = await fetchText(url);
      attempt.ok = response.ok;
      attempt.status = response.status;
      if (response.ok) {
        const extracted = extractDailyDeals(response.text, { mercado: source.mercado, url }, items);
        attempt.count = extracted.length;
        deals.push(...extracted);
      }
    } catch (error) {
      attempt.error = error.name === "AbortError" ? "Tempo esgotado ao acessar o site" : error.message;
    }
    attempts.push(attempt);
  }

  const seen = new Set();
  const uniqueDeals = deals.filter((deal) => {
    const key = `${deal.mercado}|${deal.item}|${deal.priceRaw}|${deal.descricao.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { mercado: source.mercado, attempts, deals: uniqueDeals };
}

async function scanDailyDeals(options = {}) {
  const startedAt = new Date().toISOString();
  const items = options.items?.length ? options.items : monitoredItems;
  const regions = options.regions?.length ? options.regions : monitoredRegions;
  const sources = options.markets?.length
    ? marketSources.filter((source) => options.markets.includes(source.mercado))
    : marketSources;
  const byMarket = [];

  for (const source of sources) {
    byMarket.push(await scanMarketSource(source, items));
  }

  const deals = byMarket.flatMap((market) => market.deals).sort((a, b) => a.priceValue - b.priceValue);
  const run = {
    id: `${Date.now()}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    items,
    regions,
    byMarket,
    deals,
    summary: {
      markets: byMarket.length,
      attempts: byMarket.reduce((total, market) => total + market.attempts.length, 0),
      deals: deals.length,
      blockedOrEmpty: byMarket.filter((market) => !market.deals.length).map((market) => market.mercado)
    }
  };

  const db = readDb();
  db.data = db.data || {};
  db.data.ofertasDia = db.data.ofertasDia || [];
  db.data.ofertasDia.unshift(run);
  db.data.ofertasDia = db.data.ofertasDia.slice(0, 30);
  writeDb(db);
  return run;
}

async function searchPublicPrices(item, regiao) {
  const run = await scanDailyDeals({ items: [item], regions: [regiao] });
  return markets.map((mercado) => {
    const marketRun = run.byMarket.find((market) => market.mercado === mercado);
    const marketDeals = run.deals.filter((deal) => deal.mercado === mercado);
    const best = marketDeals[0] || null;
    const query = `${mercado} ${regiao} oferta preço ${item}`;
    return {
      mercado,
      query,
      url: best?.sourceUrl || `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      foundPrices: marketDeals.map((deal) => deal.priceRaw),
      bestPrice: best ? {
        raw: best.priceRaw,
        value: best.priceValue,
        description: best.descricao,
        sourceUrl: best.sourceUrl
      } : null,
      attempts: marketRun?.attempts || []
    };
  });
}

async function runPromotionMonitor(options = {}) {
  const startedAt = new Date().toISOString();
  const items = options.items || monitoredItems;
  const regions = options.regions || monitoredRegions;
  const results = [];
  const dailyDeals = await scanDailyDeals({ items, regions });

  for (const regiao of regions) {
    for (const item of items) {
      const pesquisas = markets.map((mercado) => {
        const marketRun = dailyDeals.byMarket.find((market) => market.mercado === mercado);
        const marketDeals = dailyDeals.deals.filter((deal) => (
          deal.mercado === mercado && normalizeText(deal.item) === normalizeText(item)
        ));
        const best = marketDeals[0] || null;
        const query = `${mercado} ${regiao} oferta preço ${item}`;
        return {
          mercado,
          query,
          url: best?.sourceUrl || `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          foundPrices: marketDeals.map((deal) => deal.priceRaw),
          bestPrice: best ? {
            raw: best.priceRaw,
            value: best.priceValue,
            description: best.descricao,
            sourceUrl: best.sourceUrl
          } : null,
          attempts: marketRun?.attempts || []
        };
      });
      results.push({
        item,
        regiao,
        pesquisas,
        bestFound: pesquisas
          .map((pesquisa) => pesquisa.bestPrice ? {
            mercado: pesquisa.mercado,
            raw: pesquisa.bestPrice.raw,
            value: pesquisa.bestPrice.value,
            url: pesquisa.url
          } : null)
          .filter(Boolean)
          .sort((a, b) => a.value - b.value)[0] || null
      });
    }
  }

  const db = readDb();
  db.data = db.data || {};
  db.data.monitorPromocoes = db.data.monitorPromocoes || [];
  const run = {
    id: `${Date.now()}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    items,
    regions,
    dailyDeals,
    results
  };
  db.data.monitorPromocoes.unshift(run);
  db.data.monitorPromocoes = db.data.monitorPromocoes.slice(0, 30);
  writeDb(db);
  return run;
}

function safeStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" || cleanPath === "/loja" || cleanPath === "/admin" ? "/index.html" : cleanPath;
  const filePath = path.resolve(rootDir, `.${requested}`);
  if (!filePath.startsWith(rootDir)) return null;
  return filePath;
}

async function handleApi(req, res) {
  ensureDb();

  if (req.url === "/api/status" && req.method === "GET") {
    sendJson(res, 200, { ok: true, storage: dbPath, updatedAt: new Date().toISOString() });
    return;
  }

  if (req.url === "/api/whatsapp/status" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      provider: whatsappConfig.provider,
      ready: whatsappReady(),
      senderTestPhone: whatsappConfig.senderTestPhone,
      nubiaPhone: whatsappConfig.nubiaPhone,
      missing: [
        !whatsappConfig.zapiInstanceId && "ZAPI_INSTANCE_ID",
        !whatsappConfig.zapiToken && "ZAPI_TOKEN",
        !whatsappConfig.zapiClientToken && "ZAPI_CLIENT_TOKEN"
      ].filter(Boolean)
    });
    return;
  }

  if (req.url === "/api/whatsapp/notify-order" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const result = await sendWhatsAppMessage(payload.to || whatsappConfig.nubiaPhone, payload.message || "");
      sendJson(res, result.sent ? 200 : 503, { ok: result.sent, result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === "/api/whatsapp/test" && req.method === "POST") {
    try {
      const result = await sendWhatsAppMessage(
        whatsappConfig.nubiaPhone,
        "Teste de integração - Marmitas da Núbia. Se esta mensagem chegou, o envio automático está ativo."
      );
      sendJson(res, result.sent ? 200 : 503, { ok: result.sent, result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === "/api/whatsapp/webhook" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const inbound = extractWebhookMessage(payload);
      const result = await applyWhatsAppDecision(inbound.text);
      sendJson(res, 200, { ok: true, inbound, result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === "/api/state" && req.method === "GET") {
    const db = readDb();
    sendJson(res, 200, db);
    return;
  }

  if (req.url === "/api/monitor/cotacoes" && req.method === "GET") {
    const db = readDb();
    const cotacoes = db.data?.cotacoes || [];
    const total = cotacoes.length;
    const mercados = [...new Set(cotacoes.map((item) => item.mercado).filter(Boolean))];
    const itens = [...new Set(cotacoes.map((item) => item.item).filter(Boolean))];
    sendJson(res, 200, {
      ok: true,
      total,
      mercados,
      itens,
      updatedAt: db.updatedAt
    });
    return;
  }

  if (req.url.startsWith("/api/price-search") && req.method === "GET") {
    const requestUrl = new URL(req.url, "http://localhost");
    const item = requestUrl.searchParams.get("item") || "";
    const regiao = requestUrl.searchParams.get("regiao") || "Recanto das Emas";
    const db = readDb();
    const cotacoes = db.data?.cotacoes || [];
    const historico = cotacoes
      .filter((cotacao) => String(cotacao.item || "").toLowerCase().includes(item.toLowerCase()))
      .sort((a, b) => Number(a.preco || 0) - Number(b.preco || 0));

    const publicResults = await searchPublicPrices(item, regiao);

    sendJson(res, 200, {
      ok: true,
      item,
      regiao,
      melhorHistorico: historico[0] || null,
      pesquisas: publicResults
    });
    return;
  }

  if (req.url === "/api/monitor/promocoes" && req.method === "GET") {
    const db = readDb();
    const runs = db.data?.monitorPromocoes || [];
    const ofertasRuns = db.data?.ofertasDia || [];
    sendJson(res, 200, {
      ok: true,
      monitoredItems,
      monitoredRegions,
      marketSources,
      lastDealsRun: ofertasRuns[0] || null,
      lastRun: runs[0] || null,
      runs
    });
    return;
  }

  if (req.url === "/api/ofertas-dia" && req.method === "GET") {
    const db = readDb();
    const runs = db.data?.ofertasDia || [];
    sendJson(res, 200, {
      ok: true,
      monitoredItems,
      monitoredRegions,
      marketSources,
      lastRun: runs[0] || null,
      runs
    });
    return;
  }

  if (req.url === "/api/ofertas-dia/run" && req.method === "POST") {
    try {
      const run = await scanDailyDeals();
      sendJson(res, 200, { ok: true, run });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === "/api/monitor/promocoes/run" && req.method === "POST") {
    try {
      const run = await runPromotionMonitor();
      sendJson(res, 200, { ok: true, run });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.url === "/api/state" && req.method === "PUT") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const db = {
        data: payload.data || {},
        updatedAt: new Date().toISOString()
      };
      writeDb(db);
      sendJson(res, 200, { ok: true, updatedAt: db.updatedAt });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "API não encontrada" });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

  const filePath = safeStaticPath(req.url);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  ensureDb();
  console.log(`Marmitas da Núbia rodando em http://127.0.0.1:${port}`);
  setInterval(() => {
    runPromotionMonitor().catch((error) => {
      console.error("Erro no monitor diário de promoções:", error.message);
    });
  }, 24 * 60 * 60 * 1000);
});
