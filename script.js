const hojeIso = new Date().toISOString().slice(0, 10);
const DB_NAME = "nubia-marmitas-db";
const DB_VERSION = 1;
const COLLECTIONS = ["pedidos", "clientes", "pratos", "despesas", "cotacoes", "ingredientes", "cardapio", "automacoes", "configuracoes"];
const WHATSAPP_NUBIA_PADRAO = "61993126544";
const API_BASE_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8055" : "";
const REGIOES_DF = [
  "Águas Claras",
  "Arniqueira",
  "Brazlândia",
  "Candangolândia",
  "Ceilândia",
  "Cruzeiro",
  "Fercal",
  "Gama",
  "Guará",
  "Itapoã",
  "Jardim Botânico",
  "Lago Norte",
  "Lago Sul",
  "Núcleo Bandeirante",
  "Paranoá",
  "Park Way",
  "Planaltina",
  "Plano Piloto",
  "Recanto das Emas",
  "Riacho Fundo I",
  "Riacho Fundo II",
  "Samambaia",
  "Santa Maria",
  "São Sebastião",
  "SCIA/Estrutural",
  "SIA",
  "Sobradinho",
  "Sobradinho II",
  "Sol Nascente/Pôr do Sol",
  "Sudoeste/Octogonal",
  "Taguatinga",
  "Varjão",
  "Vicente Pires",
  "Água Quente",
  "Arapoanga"
];
const MERCADOS_COTACAO = ["Atacadão DIA-A-DIA", "Super Adega Atacadista", "Vivendas", "Tatico"];

let banco = null;
let backendDisponivel = false;
let carrinho = [];
let monitorPromocoes = null;
let whatsappApi = null;
let centralPedidosAtiva = false;
let alertaPedidoTimer = null;
let ultimoPedidoConhecido = localStorage.getItem("ultimoPedidoConhecido") || "";

let pedidos = carregar("pedidos", []);
let clientes = carregar("clientes", []);
let pratos = carregar("pratos", []);
let despesas = carregar("despesas", []);
let cotacoes = carregar("cotacoes", []);
let ingredientes = carregar("ingredientes", []);
let cardapio = carregar("cardapio", {
  segunda: "Frango grelhado com legumes",
  terca: "Carne de panela com arroz",
  quarta: "Strogonoff caseiro",
  quinta: "Panqueca recheada",
  sexta: "Feijoada completa",
  fotoSegunda: "",
  fotoTerca: "",
  fotoQuarta: "",
  fotoQuinta: "",
  fotoSexta: ""
});
let automacoes = carregar("automacoes", {
  minimoRecompra: 5,
  diaRecompra: 5,
  horaRecompra: "19:00",
  ultimaNotificacao: ""
});
let configuracoes = carregar("configuracoes", {
  whatsappNubia: WHATSAPP_NUBIA_PADRAO
});

function carregar(chave, fallback) {
  try {
    return JSON.parse(localStorage.getItem(chave)) || fallback;
  } catch {
    return fallback;
  }
}

function salvar(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));
  if (banco) {
    salvarBanco(chave, valor);
  }
  salvarEstadoBackendDebounced();
}

let backendTimer = null;

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function estadoAtual() {
  return {
    pedidos,
    clientes,
    pratos,
    despesas,
    cotacoes,
    ingredientes,
    cardapio,
    automacoes,
    configuracoes
  };
}

function aplicarEstadoRemoto(estado) {
  if (!estado || typeof estado !== "object") return;
  pedidos = estado.pedidos || pedidos;
  clientes = estado.clientes || clientes;
  pratos = estado.pratos || pratos;
  despesas = estado.despesas || despesas;
  cotacoes = estado.cotacoes || cotacoes;
  ingredientes = estado.ingredientes || ingredientes;
  cardapio = estado.cardapio || cardapio;
  automacoes = estado.automacoes || automacoes;
  configuracoes = estado.configuracoes || configuracoes;

  Object.entries(estadoAtual()).forEach(([chave, valor]) => {
    localStorage.setItem(chave, JSON.stringify(valor));
    if (banco) salvarBanco(chave, valor);
  });
}

async function carregarEstadoBackend() {
  try {
    const resposta = await fetch(apiUrl("/api/state"), { cache: "no-store" });
    if (!resposta.ok) throw new Error("Backend indisponível");
    const payload = await resposta.json();
    backendDisponivel = true;
    aplicarEstadoRemoto(payload.data);
  } catch {
    backendDisponivel = false;
  }
}

async function carregarMonitorPromocoes() {
  try {
    const resposta = await fetch(apiUrl("/api/monitor/promocoes"), { cache: "no-store" });
    if (!resposta.ok) throw new Error("Monitor indisponível");
    monitorPromocoes = await resposta.json();
  } catch {
    monitorPromocoes = null;
  }
}

async function carregarStatusWhatsApp() {
  try {
    const resposta = await fetch(apiUrl("/api/whatsapp/status"), { cache: "no-store" });
    if (!resposta.ok) throw new Error("WhatsApp indisponível");
    whatsappApi = await resposta.json();
  } catch {
    whatsappApi = null;
  }
}

async function salvarEstadoBackend() {
  if (!backendDisponivel) return;
  try {
    const resposta = await fetch(apiUrl("/api/state"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: estadoAtual() })
    });
    backendDisponivel = resposta.ok;
  } catch {
    backendDisponivel = false;
  }
}

function salvarEstadoBackendDebounced() {
  clearTimeout(backendTimer);
  backendTimer = setTimeout(salvarEstadoBackend, 400);
}

function abrirBanco() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("collections")) {
        db.createObjectStore("collections", { keyPath: "name" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function lerBanco(chave) {
  return new Promise((resolve) => {
    if (!banco) {
      resolve(null);
      return;
    }

    const tx = banco.transaction("collections", "readonly");
    const store = tx.objectStore("collections");
    const request = store.get(chave);
    request.onsuccess = () => resolve(request.result ? request.result.value : null);
    request.onerror = () => resolve(null);
  });
}

function salvarBanco(chave, valor) {
  return new Promise((resolve) => {
    if (!banco) {
      resolve();
      return;
    }

    const tx = banco.transaction("collections", "readwrite");
    tx.objectStore("collections").put({
      name: chave,
      value: valor,
      updatedAt: new Date().toISOString()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function iniciarBancoLocal() {
  try {
    banco = await abrirBanco();
    if (!banco) return;

    const padroes = {
      pedidos,
      clientes,
      pratos,
      despesas,
      cotacoes,
      ingredientes,
      cardapio,
      automacoes,
      configuracoes
    };

    for (const chave of COLLECTIONS) {
      const valorBanco = await lerBanco(chave);
      if (valorBanco !== null) {
        localStorage.setItem(chave, JSON.stringify(valorBanco));
      } else {
        await salvarBanco(chave, carregar(chave, padroes[chave]));
      }
    }

    pedidos = carregar("pedidos", []);
    clientes = carregar("clientes", []);
    pratos = carregar("pratos", []);
    despesas = carregar("despesas", []);
    cotacoes = carregar("cotacoes", []);
    ingredientes = carregar("ingredientes", []);
    cardapio = carregar("cardapio", cardapio);
    automacoes = carregar("automacoes", automacoes);
    configuracoes = carregar("configuracoes", {});
  } catch (error) {
    console.warn("Banco local indisponível, usando armazenamento simples.", error);
  }
}

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatarData(data) {
  if (!data) return "Sem data";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function limparTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function abrirWhatsApp(telefone, mensagem) {
  const numero = limparTelefone(telefone);
  const destino = numero ? `55${numero}` : "";
  const link = `https://wa.me/${destino}?text=${encodeURIComponent(mensagem)}`;
  window.open(link, "_blank", "noopener,noreferrer");
}

function whatsappNubia() {
  return limparTelefone(configuracoes.whatsappNubia || WHATSAPP_NUBIA_PADRAO);
}

function aplicarNumeroTesteWhatsApp() {
  const numeroAtual = limparTelefone(configuracoes.whatsappNubia);
  if (numeroAtual !== WHATSAPP_NUBIA_PADRAO) {
    configuracoes.whatsappNubia = WHATSAPP_NUBIA_PADRAO;
    salvar("configuracoes", configuracoes);
  }
}

function diasDesde(data) {
  if (!data) return Infinity;
  const inicio = new Date(`${data}T00:00:00`);
  const hoje = new Date(`${hojeIso}T00:00:00`);
  return Math.floor((hoje - inicio) / 86400000);
}

function tempoDesde(iso) {
  const criado = new Date(iso || Date.now());
  const minutos = Math.max(1, Math.floor((Date.now() - criado.getTime()) / 60000));
  if (minutos < 60) return `chegou ha ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `chegou ha ${horas}h`;
  return `chegou em ${criado.toLocaleDateString("pt-BR")}`;
}

function fotoAutomatica(prato) {
  const texto = String(prato || "").toLowerCase();
  const fotosReais = [
    {
      termos: ["peito de frango", "frango grelhado", "filé de frango", "file de frango"],
      url: "https://i.postimg.cc/65f4nPJ4/1774051713715.png"
    },
    {
      termos: ["strogonoff", "estrogonofe"],
      url: "https://i.postimg.cc/xT3NMZDz/1774051823106.png"
    },
    {
      termos: ["feijoada"],
      url: "https://i.postimg.cc/yYy3cG4R/1774051931197.png"
    },
    {
      termos: ["carne cozida", "carne de panela", "mandioca"],
      url: "https://i.postimg.cc/x8KJsxkn/1774051595708.png"
    },
    {
      termos: ["bife acebolado"],
      url: "https://i.postimg.cc/W1pFn7Ty/1774052599529.png"
    },
    {
      termos: ["tilápia", "tilapia", "filé de tilápia", "file de tilapia"],
      url: "https://i.postimg.cc/dVQkB9JJ/1774052751306.png"
    }
  ];
  const encontrada = fotosReais.find((foto) => foto.termos.some((termo) => texto.includes(termo)));
  if (encontrada) return encontrada.url;

  const titulo = encodeURIComponent(String(prato || "Foto real do prato"));
  return `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 900 620'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23fff7f3'/%3E%3Cstop offset='1' stop-color='%23e9f8f1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='900' height='620' fill='url(%23g)'/%3E%3Ccircle cx='710' cy='120' r='180' fill='%23d7654e' opacity='.12'/%3E%3Ccircle cx='190' cy='510' r='220' fill='%23bfe6d4' opacity='.34'/%3E%3Ctext x='450' y='265' text-anchor='middle' font-family='Georgia, serif' font-size='58' fill='%23a84f3f'%3EMarmitas da Núbia%3C/text%3E%3Ctext x='450' y='335' text-anchor='middle' font-family='Arial, sans-serif' font-size='28' font-weight='700' fill='%23746b68'%3EFoto real do prato%3C/text%3E%3Ctext x='450' y='386' text-anchor='middle' font-family='Arial, sans-serif' font-size='22' fill='%23746b68'%3E${titulo}%3C/text%3E%3C/svg%3E`;
}

function buscarPrato(nome) {
  return pratos.find((prato) => normalizarTexto(prato.nome) === normalizarTexto(nome));
}

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function deduplicarPratos() {
  const vistos = new Map();
  pratos.forEach((prato) => {
    const chave = normalizarTexto(prato.nome);
    if (!chave) return;
    const existente = vistos.get(chave);
    if (!existente) {
      vistos.set(chave, prato);
      return;
    }
    vistos.set(chave, {
      ...existente,
      ...prato,
      id: existente.id,
      foto: existente.foto || prato.foto,
      descricao: existente.descricao || prato.descricao,
      preco: existente.preco || prato.preco,
      custo: existente.custo || prato.custo,
      status: existente.status === "Disponível" || prato.status === "Disponível" ? "Disponível" : (existente.status || prato.status)
    });
  });
  const unicos = Array.from(vistos.values());
  if (unicos.length !== pratos.length) {
    pratos = unicos;
    salvar("pratos", pratos);
  }
}

function removerPratosIndesejados() {
  const bloqueados = ["costela fitness", "prato especial da casa"];
  let alterou = false;
  pratos = pratos.filter((prato) => {
    const remover = bloqueados.includes(normalizarTexto(prato.nome));
    if (remover) alterou = true;
    return !remover;
  });

  ["segunda", "terca", "quarta", "quinta", "sexta"].forEach((chave) => {
    if (bloqueados.includes(normalizarTexto(cardapio[chave]))) {
      cardapio[chave] = "";
      alterou = true;
    }
  });

  if (alterou) {
    salvar("pratos", pratos);
    salvar("cardapio", cardapio);
  }
}

function garantirPratosFixos() {
  const fixos = [
    {
      nome: "Escondidinho de carne desfiada",
      categoria: "Especial",
      preco: 22,
      custo: 12,
      foto: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ1-4SRBzWsQsajCvdlKyLxEz1y2v5_qhakVg&s",
      descricao: "Purê cremoso com recheio de carne desfiada bem temperada e finalização caseira.",
      status: "Disponível"
    }
  ];

  let alterou = false;
  fixos.forEach((fixo) => {
    const existente = pratos.find((prato) => normalizarTexto(prato.nome) === normalizarTexto(fixo.nome));
    if (existente) {
      Object.assign(existente, { ...fixo, id: existente.id });
    } else {
      pratos.unshift({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        ...fixo,
        criadoEm: new Date().toISOString()
      });
    }
    alterou = true;
  });

  if (alterou) {
    salvar("pratos", pratos);
  }
}

function imagemDoPrato(nome) {
  const prato = buscarPrato(nome);
  return prato?.foto || fotoAutomatica(nome);
}

function precoDoPrato(nome) {
  return Number(buscarPrato(nome)?.preco || 0);
}

function custoDoPrato(nome) {
  return Number(buscarPrato(nome)?.custo || 0);
}

function diasCardapio() {
  return [
    { chave: "segunda", foto: "fotoSegunda", nome: "Segunda-feira" },
    { chave: "terca", foto: "fotoTerca", nome: "Terça-feira" },
    { chave: "quarta", foto: "fotoQuarta", nome: "Quarta-feira" },
    { chave: "quinta", foto: "fotoQuinta", nome: "Quinta-feira" },
    { chave: "sexta", foto: "fotoSexta", nome: "Sexta-feira" }
  ];
}

function baixarArquivo(nome, conteudo, tipo = "application/json") {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

function mostrarCardapio() {
  preencherSelectsCardapio();
  ["segunda", "terca", "quarta", "quinta", "sexta", "fotoSegunda", "fotoTerca", "fotoQuarta", "fotoQuinta", "fotoSexta"].forEach((dia) => {
    const campo = document.getElementById(dia);
    if (campo) campo.value = cardapio[dia] || "";
  });

  document.getElementById("cardapioSalvo").innerHTML = diasCardapio()
    .map(({ chave, nome }) => `
      <div class="menu-day">
        <span>${nome}</span>
        <strong>${cardapio[chave] || "A definir"}</strong>
      </div>
    `)
    .join("");

  document.getElementById("opcoesCardapio").innerHTML = [...new Set([
    ...Object.values(cardapio).filter((valor) => typeof valor === "string" && !valor.startsWith("http")),
    ...pratos.filter((prato) => prato.status !== "Indisponível").map((prato) => prato.nome)
  ])]
    .filter(Boolean)
    .map((item) => `<option value="${item}"></option>`)
    .join("");

  montarCardapioPdf();
}

function preencherSelectsCardapio() {
  const opcoes = ['<option value="">A definir</option>']
    .concat(pratos
      .filter((prato) => prato.status !== "Indisponível")
      .map((prato) => `<option value="${prato.nome}">${prato.nome} - ${dinheiro(prato.preco)}</option>`))
    .join("");

  ["segunda", "terca", "quarta", "quinta", "sexta"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select || select.dataset.loaded === String(pratos.length)) return;
    const valorAtual = select.value || cardapio[id] || "";
    select.innerHTML = opcoes;
    select.value = valorAtual;
    select.dataset.loaded = String(pratos.length);
  });
}

function salvarCardapio(event) {
  if (event) event.preventDefault();
  cardapio = {
    segunda: document.getElementById("segunda").value.trim(),
    terca: document.getElementById("terca").value.trim(),
    quarta: document.getElementById("quarta").value.trim(),
    quinta: document.getElementById("quinta").value.trim(),
    sexta: document.getElementById("sexta").value.trim(),
    fotoSegunda: document.getElementById("fotoSegunda").value.trim(),
    fotoTerca: document.getElementById("fotoTerca").value.trim(),
    fotoQuarta: document.getElementById("fotoQuarta").value.trim(),
    fotoQuinta: document.getElementById("fotoQuinta").value.trim(),
    fotoSexta: document.getElementById("fotoSexta").value.trim()
  };
  salvar("cardapio", cardapio);
  mostrarCardapio();
}

function montarCardapioPdf() {
  const alvo = document.getElementById("cardapioPdf");
  if (!alvo) return;

  alvo.innerHTML = `
    <section class="pdf-sheet">
      <div class="pdf-head">
        <img src="assets/logo-nubia.png" alt="Logo Núbia Marmitas">
        <div>
          <span>Cardápio da semana</span>
          <h3>Marmitas da Núbia</h3>
          <p>Deliciosa, caseira, comida com afeto</p>
        </div>
      </div>
      <div class="pdf-menu-grid">
        ${diasCardapio().map(({ chave, foto, nome }) => {
          const prato = cardapio[chave];
          if (!prato || !buscarPrato(prato)) return "";
          const pratoCatalogo = buscarPrato(prato);
          const imagem = cardapio[foto] || pratoCatalogo?.foto || fotoAutomatica(prato);
          const preco = pratoCatalogo?.preco ? dinheiro(pratoCatalogo.preco) : "";
          return `
            <article class="pdf-dish">
              <img src="${imagem}" alt="${prato}">
              <div>
                <span>${nome}</span>
                <strong>${prato}</strong>
                ${preco ? `<em>${preco}</em>` : ""}
                ${pratoCatalogo?.descricao ? `<p>${pratoCatalogo.descricao}</p>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </div>
      <footer class="pdf-footer">
        <span>Encomendas pelo WhatsApp</span>
        <strong>Marmitas da Núbia</strong>
      </footer>
    </section>
  `;
}

function baixarCardapioPdf() {
  montarCardapioPdf();
  window.print();
}

function enviarCardapioWhatsApp() {
  const mensagem = `Olá! Segue o cardápio da semana das Marmitas da Núbia:

Segunda: ${cardapio.segunda || "-"}
Terça: ${cardapio.terca || "-"}
Quarta: ${cardapio.quarta || "-"}
Quinta: ${cardapio.quinta || "-"}
Sexta: ${cardapio.sexta || "-"}

Posso anotar seu pedido?`;

  abrirWhatsApp("", mensagem);
}

function adicionarPedido(event) {
  if (event) event.preventDefault();

  const pedido = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    cliente: document.getElementById("cliente").value.trim(),
    telefone: document.getElementById("telefone").value.trim(),
    marmita: document.getElementById("marmita").value.trim(),
    quantidade: Number(document.getElementById("quantidade").value),
    valorUnitario: Number(document.getElementById("valorUnitario").value || 0),
    dataEntrega: document.getElementById("dataEntrega").value,
    formaRecebimento: document.getElementById("formaRecebimento").value,
    formaPagamento: document.getElementById("formaPagamento").value,
    status: document.getElementById("status").value,
    statusEntrega: "Preparando",
    observacao: document.getElementById("observacao").value.trim(),
    criadoEm: new Date().toISOString()
  };

  if (!pedido.cliente || !pedido.marmita || !pedido.quantidade || !pedido.dataEntrega) {
    alert("Preencha cliente, marmita, quantidade e data de entrega.");
    return;
  }

  pedidos.unshift(pedido);
  salvarClientePorPedido(pedido);
  salvar("pedidos", pedidos);
  event.target.reset();
  document.getElementById("quantidade").value = 1;
  document.getElementById("dataEntrega").value = hojeIso;
  atualizarTela();
  trocarAba("pedidos");
}

function salvarClientePorPedido(pedido) {
  if (!pedido.cliente) return;
  const chavePedido = limparTelefone(pedido.telefone) || pedido.cliente.toLowerCase();
  const existente = clientes.find((cliente) => (limparTelefone(cliente.telefone) || cliente.nome.toLowerCase()) === chavePedido);

  if (existente) {
    existente.nome = pedido.cliente;
    existente.telefone = pedido.telefone || existente.telefone;
    existente.preferencia = existente.preferencia || pedido.marmita;
    existente.ultimoPedido = pedido.dataEntrega;
  } else {
    clientes.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      nome: pedido.cliente,
      telefone: pedido.telefone,
      preferencia: pedido.marmita,
      aniversario: "",
      observacao: "Cliente criado automaticamente a partir de pedido.",
      criadoEm: new Date().toISOString(),
      ultimoPedido: pedido.dataEntrega
    });
  }

  salvar("clientes", clientes);
}

function adicionarCliente(event) {
  event.preventDefault();

  const cliente = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    nome: document.getElementById("clienteNome").value.trim(),
    telefone: document.getElementById("clienteTelefone").value.trim(),
    preferencia: document.getElementById("clientePreferencia").value.trim(),
    aniversario: document.getElementById("clienteAniversario").value,
    observacao: document.getElementById("clienteObservacao").value.trim(),
    criadoEm: new Date().toISOString(),
    ultimoPedido: ""
  };

  if (!cliente.nome || !cliente.telefone) {
    alert("Preencha nome e telefone do cliente.");
    return;
  }

  clientes.unshift(cliente);
  salvar("clientes", clientes);
  event.target.reset();
  atualizarTela();
  trocarAba("clientes");
}

function dadosCliente(cliente) {
  const telefone = limparTelefone(cliente.telefone);
  const pedidosCliente = pedidos.filter((pedido) => {
    const mesmoTelefone = telefone && limparTelefone(pedido.telefone) === telefone;
    const mesmoNome = pedido.cliente.toLowerCase() === cliente.nome.toLowerCase();
    return mesmoTelefone || mesmoNome;
  });
  const ultimoPedido = pedidosCliente.reduce((ultimo, pedido) => {
    if (!ultimo || pedido.dataEntrega > ultimo) return pedido.dataEntrega;
    return ultimo;
  }, cliente.ultimoPedido || "");
  const totalMarmitas = pedidosCliente.reduce((total, pedido) => total + pedido.quantidade, 0);
  const ativo = diasDesde(ultimoPedido) <= 25;

  return { pedidosCliente, ultimoPedido, totalMarmitas, ativo };
}

function clientesFiltrados() {
  const busca = document.getElementById("buscaClientes")?.value.toLowerCase() || "";
  const filtro = document.getElementById("filtroClientes")?.value || "Todos";

  return clientes.filter((cliente) => {
    const dados = dadosCliente(cliente);
    const texto = `${cliente.nome} ${cliente.telefone} ${cliente.preferencia} ${cliente.observacao}`.toLowerCase();
    const combinaTexto = texto.includes(busca);
    const combinaFiltro = filtro === "Todos" || (filtro === "Ativos" && dados.ativo) || (filtro === "Retomar" && !dados.ativo);
    return combinaTexto && combinaFiltro;
  });
}

function mostrarClientes() {
  const lista = document.getElementById("listaClientes");
  if (!lista) return;

  const filtrados = clientesFiltrados();
  const ativos = clientes.filter((cliente) => dadosCliente(cliente).ativo).length;
  const retomar = clientes.filter((cliente) => !dadosCliente(cliente).ativo).length;

  document.getElementById("clientesAtivos").innerText = ativos;
  document.getElementById("clientesSaudade").innerText = retomar;
  document.getElementById("clientesTotal").innerText = clientes.length;

  if (!filtrados.length) {
    lista.innerHTML = '<div class="empty-state">Nenhum cliente encontrado.</div>';
    return;
  }

  lista.innerHTML = filtrados.map((cliente) => {
    const dados = dadosCliente(cliente);
    return `
      <article class="order-card client-card">
        <div>
          <span class="badge ${dados.ativo ? "entregue" : "pendente"}">${dados.ativo ? "Ativo" : "Retomar contato"}</span>
          <h3>${cliente.nome}</h3>
          <div class="order-meta">
            <span>${cliente.telefone || "Sem telefone"}</span>
            <span>${dados.totalMarmitas} marmitas no histórico</span>
            <span>Último pedido: ${dados.ultimoPedido ? formatarData(dados.ultimoPedido) : "sem pedido"}</span>
            <span>${cliente.preferencia || "sem preferência"}</span>
          </div>
          ${cliente.observacao ? `<p>${cliente.observacao}</p>` : ""}
        </div>
        <div class="order-actions">
          <button type="button" onclick="enviarMensagemSaudade('${cliente.id}')">Retomar contato</button>
          <button type="button" onclick="enviarMensagemCliente('${cliente.id}')">WhatsApp</button>
          <button class="danger" type="button" onclick="excluirCliente('${cliente.id}')">Excluir</button>
        </div>
      </article>
    `;
  }).join("");
}

function excluirCliente(id) {
  if (!confirm("Excluir este cliente?")) return;
  clientes = clientes.filter((cliente) => cliente.id !== id);
  salvar("clientes", clientes);
  atualizarTela();
}

function mensagemSaudade(cliente) {
  const dados = dadosCliente(cliente);
  return `Olá, ${cliente.nome}! Tudo bem?

Passando com carinho para dizer que sentimos saudade dos seus pedidos aqui na Marmitas da Núbia.

Já faz um tempinho desde sua última encomenda${dados.ultimoPedido ? `, em ${formatarData(dados.ultimoPedido)}` : ""}. Quer que eu te envie o cardápio da semana ou reserve suas marmitas favoritas?`;
}

function enviarMensagemSaudade(id) {
  const cliente = clientes.find((item) => item.id === id);
  if (!cliente) return;
  abrirWhatsApp(cliente.telefone, mensagemSaudade(cliente));
}

function enviarMensagemCliente(id) {
  const cliente = clientes.find((item) => item.id === id);
  if (!cliente) return;
  abrirWhatsApp(cliente.telefone, `Olá, ${cliente.nome}! Tudo bem? Aqui é da Marmitas da Núbia. Posso te ajudar com seu pedido da semana?`);
}

function gerarSaudadesWhatsApp() {
  document.getElementById("filtroClientes").value = "Retomar";
  mostrarClientes();
  trocarAba("clientes");
}

function adicionarPrato(event) {
  event.preventDefault();

  const editId = document.getElementById("pratoEditId").value;
  const nome = document.getElementById("pratoNome").value.trim();
  const prato = {
    id: editId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    nome,
    categoria: document.getElementById("pratoCategoria").value,
    preco: Number(document.getElementById("pratoPreco").value || 0),
    custo: Number(document.getElementById("pratoCusto").value || 0),
    foto: document.getElementById("pratoFoto").value.trim() || fotoAutomatica(nome),
    descricao: document.getElementById("pratoDescricao").value.trim(),
    status: document.getElementById("pratoStatus").value,
    criadoEm: new Date().toISOString()
  };

  if (!prato.nome || !prato.preco) {
    alert("Preencha nome e preço do prato.");
    return;
  }

  const existente = pratos.find((item) => item.id === editId || normalizarTexto(item.nome) === normalizarTexto(prato.nome));
  if (existente) {
    Object.assign(existente, prato, { id: existente.id });
  } else {
    pratos.unshift(prato);
  }

  salvar("pratos", pratos);
  event.target.reset();
  document.getElementById("pratoEditId").value = "";
  atualizarTela();
  trocarAba("pratos");
}

function popularPratosExemplo() {
  const sugestoes = [
    {
      nome: "Frango grelhado com arroz, feijão e legumes",
      categoria: "Tradicional",
      preco: 18,
      custo: 9,
      foto: "",
      descricao: "Frango suculento, arroz soltinho, feijão caseiro e legumes coloridos.",
      status: "Disponível"
    },
    {
      nome: "Carne de panela com mandioca",
      categoria: "Especial",
      preco: 22,
      custo: 12,
      foto: "",
      descricao: "Carne macia, molho encorpado e acompanhamento com sabor de casa.",
      status: "Disponível"
    },
    {
      nome: "Strogonoff caseiro com batata palha",
      categoria: "Tradicional",
      preco: 20,
      custo: 10,
      foto: "",
      descricao: "Cremoso, bem temperado e perfeito para uma refeição acolhedora.",
      status: "Disponível"
    },
    {
      nome: "Panqueca recheada ao molho",
      categoria: "Especial",
      preco: 19,
      custo: 9.5,
      foto: "",
      descricao: "Massa leve, recheio generoso e molho caseiro finalizado com carinho.",
      status: "Disponível"
    },
    {
      nome: "Feijoada completa da sexta",
      categoria: "Especial",
      preco: 25,
      custo: 14,
      foto: "",
      descricao: "Feijão preto bem temperado, arroz, couve, farofa e aquele sabor de sexta.",
      status: "Disponível"
    }
  ];

  sugestoes.forEach((sugestao) => {
    if (!pratos.some((prato) => normalizarTexto(prato.nome) === normalizarTexto(sugestao.nome))) {
      pratos.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        ...sugestao,
        criadoEm: new Date().toISOString()
      });
    }
  });

  salvar("pratos", pratos);
  atualizarTela();
}

function mostrarPratos() {
  const lista = document.getElementById("listaPratos");
  if (!lista) return;

  if (!pratos.length) {
    lista.innerHTML = '<div class="empty-state">Cadastre os pratos para montar cardápios mais bonitos e calcular lucro.</div>';
    return;
  }

  lista.innerHTML = pratos.map((prato) => {
    const margem = Number(prato.preco || 0) - Number(prato.custo || 0);
    return `
      <article class="dish-card">
        <img src="${prato.foto || fotoAutomatica(prato.nome)}" alt="${prato.nome}">
        <div>
          <span class="badge ${prato.status === "Disponível" ? "entregue" : "pendente"}">${prato.status}</span>
          <h3>${prato.nome}</h3>
          <p>${prato.descricao || "Prato caseiro preparado com cuidado."}</p>
          <div class="order-meta">
            <span>${prato.categoria}</span>
            <span>Venda: ${dinheiro(prato.preco)}</span>
            <span>Custo: ${dinheiro(prato.custo)}</span>
            <span>Margem: ${dinheiro(margem)}</span>
          </div>
        </div>
        <div class="order-actions">
          <button type="button" onclick="editarPrato('${prato.id}')">Editar</button>
          <button type="button" onclick="usarPratoNoPedido('${prato.id}')">Usar no pedido</button>
          <button type="button" onclick="usarPratoNoCardapio('${prato.id}')">Usar no cardápio</button>
          <button class="danger" type="button" onclick="excluirPrato('${prato.id}')">Excluir</button>
        </div>
      </article>
    `;
  }).join("");
}

function editarPrato(id) {
  const prato = pratos.find((item) => item.id === id);
  if (!prato) return;

  document.getElementById("pratoEditId").value = prato.id;
  document.getElementById("pratoNome").value = prato.nome || "";
  document.getElementById("pratoCategoria").value = prato.categoria || "Tradicional";
  document.getElementById("pratoPreco").value = prato.preco || "";
  document.getElementById("pratoCusto").value = prato.custo || "";
  document.getElementById("pratoFoto").value = prato.foto || "";
  document.getElementById("pratoDescricao").value = prato.descricao || "";
  document.getElementById("pratoStatus").value = prato.status || "Disponível";
  trocarAba("pratos");
  document.getElementById("pratoNome").focus();
}

function cancelarEdicaoPrato() {
  document.getElementById("formPrato").reset();
  document.getElementById("pratoEditId").value = "";
}

function usarPratoNoPedido(id) {
  const prato = pratos.find((item) => item.id === id);
  if (!prato) return;
  document.getElementById("marmita").value = prato.nome;
  document.getElementById("valorUnitario").value = prato.preco;
  trocarAba("pedidos");
}

function usarPratoNoCardapio(id) {
  const prato = pratos.find((item) => item.id === id);
  if (!prato) return;
  const primeiroVazio = diasCardapio().find(({ chave }) => !document.getElementById(chave).value);
  const alvo = primeiroVazio || diasCardapio()[0];
  document.getElementById(alvo.chave).value = prato.nome;
  document.getElementById(alvo.foto).value = prato.foto;
  trocarAba("cardapio");
}

function excluirPrato(id) {
  if (!confirm("Excluir este prato?")) return;
  pratos = pratos.filter((prato) => prato.id !== id);
  salvar("pratos", pratos);
  atualizarTela();
}

function preencherPedidoPorPrato() {
  const prato = buscarPrato(document.getElementById("marmita").value);
  if (!prato) return;
  document.getElementById("valorUnitario").value = prato.preco;
}

function pratosDisponiveisLoja() {
  return pratos.filter((prato) => prato.status !== "Indisponível");
}

function mostrarLojaCliente() {
  const vitrine = document.getElementById("vitrineCliente");
  if (!vitrine) return;
  mostrarOpcoesSemanaCliente();
  const disponiveis = pratosDisponiveisLoja();

  if (!disponiveis.length) {
    vitrine.innerHTML = '<div class="empty-state">O cardápio de compra aparece aqui assim que os pratos forem cadastrados.</div>';
  } else {
    vitrine.innerHTML = disponiveis.map((prato) => `
      <article class="store-card">
        <img src="${prato.foto || fotoAutomatica(prato.nome)}" alt="${prato.nome}">
        <div>
          <span>${prato.categoria}</span>
          <h3>${prato.nome}</h3>
          <p>${prato.descricao || "Marmita caseira feita com capricho."}</p>
          <strong>${dinheiro(prato.preco)}</strong>
          <button type="button" onclick="adicionarAoCarrinho('${prato.id}')">Adicionar</button>
        </div>
      </article>
    `).join("");
  }

  mostrarCarrinho();
}

function mostrarOpcoesSemanaCliente() {
  const alvo = document.getElementById("opcoesSemanaCliente");
  if (!alvo) return;

  const opcoes = diasCardapio()
    .map(({ chave, foto, nome }) => {
      const pratoNome = cardapio[chave];
      if (!pratoNome) return null;
      const prato = buscarPrato(pratoNome);
      return {
        dia: nome,
        nome: pratoNome,
        preco: Number(prato?.preco || 0),
        foto: cardapio[foto] || prato?.foto || fotoAutomatica(pratoNome),
        descricao: prato?.descricao || "Opção caseira da semana, preparada com capricho."
      };
    })
    .filter(Boolean);

  if (!opcoes.length) {
    alvo.innerHTML = '<div class="empty-state">As opções da semana aparecem aqui quando o cardápio for salvo.</div>';
    return;
  }

  alvo.innerHTML = opcoes.map((opcao, index) => `
    <article class="week-card">
      <img src="${opcao.foto}" alt="${opcao.nome}">
      <div>
        <span>${opcao.dia}</span>
        <h3>${opcao.nome}</h3>
        <p>${opcao.descricao}</p>
        <strong>${opcao.preco ? dinheiro(opcao.preco) : "Consulte"}</strong>
        <button type="button" onclick="adicionarOpcaoSemana(${index})">Quero esta</button>
      </div>
    </article>
  `).join("");
}

function adicionarOpcaoSemana(index) {
  const opcoes = diasCardapio()
    .map(({ chave }) => cardapio[chave])
    .filter(Boolean);
  const nome = opcoes[index];
  if (!nome) return;
  const prato = buscarPrato(nome);
  const id = prato?.id || `semana-${index}-${nome}`;
  const item = carrinho.find((produto) => produto.id === id);

  if (item) {
    item.quantidade += 1;
  } else {
    carrinho.push({
      id,
      nome,
      preco: Number(prato?.preco || 0),
      quantidade: 1
    });
  }

  mostrarCarrinho();
}

function adicionarAoCarrinho(id) {
  const prato = pratos.find((item) => item.id === id);
  if (!prato) return;
  const item = carrinho.find((produto) => produto.id === id);
  if (item) {
    item.quantidade += 1;
  } else {
    carrinho.push({
      id: prato.id,
      nome: prato.nome,
      preco: Number(prato.preco || 0),
      quantidade: 1
    });
  }
  mostrarCarrinho();
}

function alterarCarrinho(id, delta) {
  carrinho = carrinho.map((item) => item.id === id ? { ...item, quantidade: item.quantidade + delta } : item)
    .filter((item) => item.quantidade > 0);
  mostrarCarrinho();
}

function limparCarrinho() {
  carrinho = [];
  mostrarCarrinho();
}

function mostrarCarrinho() {
  const alvo = document.getElementById("carrinhoCliente");
  if (!alvo) return;
  const total = carrinho.reduce((soma, item) => soma + item.preco * item.quantidade, 0);

  if (!carrinho.length) {
    alvo.innerHTML = '<div class="empty-state">Seu carrinho está vazio.</div>';
    return;
  }

  alvo.innerHTML = `
    ${carrinho.map((item) => `
      <div class="cart-item">
        <div>
          <strong>${item.nome}</strong>
          <span>${item.quantidade}x ${dinheiro(item.preco)}</span>
        </div>
        <div>
          <button type="button" onclick="alterarCarrinho('${item.id}', -1)">-</button>
          <button type="button" onclick="alterarCarrinho('${item.id}', 1)">+</button>
        </div>
      </div>
    `).join("")}
    <div class="cart-total"><span>Total</span><strong>${dinheiro(total)}</strong></div>
  `;
}

async function notificarPedidoWhatsApp(mensagem) {
  try {
    const response = await fetch(apiUrl("/api/whatsapp/notify-order"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: whatsappNubia(),
        message: mensagem
      })
    });
    const payload = await response.json().catch(() => ({}));
    return {
      sent: response.ok,
      reason: payload.result?.reason || payload.error || "Envio automático indisponível."
    };
  } catch {
    return {
      sent: false,
      reason: "Backend de WhatsApp não respondeu."
    };
  }
}

function atualizarLinkPedido() {
  const alvo = document.getElementById("linkPedidoCliente");
  if (!alvo) return;
  alvo.innerText = `${window.location.origin}/loja`;
}

async function copiarLinkPedido() {
  const link = `${window.location.origin}/loja`;
  try {
    await navigator.clipboard.writeText(link);
    alert("Link de pedido copiado.");
  } catch {
    window.prompt("Copie o link de pedido:", link);
  }
}

function gerarComprovantePedido(dados) {
  const alvo = document.getElementById("comprovantePedido");
  if (!alvo) return;
  alvo.classList.remove("hidden");
  alvo.innerHTML = `
    <div class="receipt-head">
      <img src="assets/logo-nubia.png" alt="Logo Marmitas da Núbia">
      <div>
        <span>Comprovante do pedido</span>
        <strong>Marmitas da Núbia</strong>
        <small>${new Date().toLocaleString("pt-BR")}</small>
      </div>
    </div>
    <div class="receipt-body">
      <p><strong>Cliente:</strong> ${dados.cliente}</p>
      <p><strong>WhatsApp:</strong> ${dados.telefone}</p>
      <p><strong>Entrega/retirada:</strong> ${dados.formaRecebimento}</p>
      <p><strong>Data desejada:</strong> ${formatarData(dados.dataEntrega)}</p>
      <p><strong>Pagamento:</strong> ${dados.formaPagamento}</p>
      ${dados.observacao ? `<p><strong>Observação:</strong> ${dados.observacao}</p>` : ""}
      <hr>
      ${dados.itens.map((item) => `
        <div class="receipt-line">
          <span>${item.quantidade}x ${item.nome}</span>
          <strong>${dinheiro(item.preco * item.quantidade)}</strong>
        </div>
      `).join("")}
      <div class="receipt-total">
        <span>Total</span>
        <strong>${dinheiro(dados.total)}</strong>
      </div>
    </div>
    <div class="receipt-actions">
      <button type="button" onclick="window.print()">Baixar/imprimir comprovante</button>
      <button type="button" onclick="enviarComprovanteCliente('${dados.telefone}', '${encodeURIComponent(dados.cliente)}')">Enviar ao cliente</button>
    </div>
  `;
  alvo.scrollIntoView({ behavior: "smooth", block: "center" });
}

function enviarComprovanteCliente(telefone, clienteCodificado) {
  const cliente = decodeURIComponent(clienteCodificado);
  abrirWhatsApp(telefone, `Olá, ${cliente}! Recebemos seu pedido na Marmitas da Núbia. Ele está aguardando confirmação da Núbia. Obrigada pelo carinho.`);
}

async function finalizarCompraCliente(event) {
  event.preventDefault();
  if (!carrinho.length) {
    alert("Adicione pelo menos uma marmita ao pedido.");
    return;
  }

  const cliente = document.getElementById("checkoutNome").value.trim();
  const telefone = document.getElementById("checkoutTelefone").value.trim();
  const dataEntrega = document.getElementById("checkoutData").value || hojeIso;
  const formaRecebimento = document.getElementById("checkoutRecebimento").value;
  const formaPagamento = document.getElementById("checkoutPagamento").value;
  const observacao = document.getElementById("checkoutObs").value.trim();
  const itensPedido = [...carrinho];
  const pedidoIds = [];

  itensPedido.forEach((item) => {
    const pedido = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      cliente,
      telefone,
      marmita: item.nome,
      quantidade: item.quantidade,
      valorUnitario: item.preco,
      dataEntrega,
      formaRecebimento,
      formaPagamento,
      status: "Pendente",
      statusEntrega: "Preparando",
      observacao,
      criadoEm: new Date().toISOString(),
      origem: "Loja do cliente"
    };
    pedidoIds.push(pedido.id);
    pedidos.unshift(pedido);
    salvarClientePorPedido(pedido);
  });

  salvar("pedidos", pedidos);

  const total = itensPedido.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
  const mensagem = `Olá, Núbia. Você tem um novo pedido aguardando confirmação.

Resumo do pedido:

${itensPedido.map((item) => `- ${item.quantidade}x ${item.nome} (${dinheiro(item.preco)} cada)`).join("\n")}

Nome: ${cliente}
WhatsApp: ${telefone}
Recebimento: ${formaRecebimento}
Pagamento: ${formaPagamento}
Data desejada: ${formatarData(dataEntrega)}
Observação: ${observacao || "-"}
Total: ${dinheiro(total)}

Para confirmar:
1 - Aceitar pedido
2 - Recusar pedido`;

  const envioWhatsApp = await notificarPedidoWhatsApp(mensagem);
  if (!envioWhatsApp.sent) {
    alert(`Pedido registrado, mas a IA ainda não conseguiu enviar sozinha no WhatsApp.\n\n${envioWhatsApp.reason}\n\nQuando configurarmos a API real, ela enviará sem você clicar em enviar.`);
  } else {
    alert("Pedido registrado e enviado automaticamente para o WhatsApp da Núbia.");
  }
  gerarComprovantePedido({
    cliente,
    telefone,
    itens: itensPedido,
    total,
    dataEntrega,
    formaRecebimento,
    formaPagamento,
    observacao,
    pedidoIds
  });
  notificarNovoPedido(cliente, itensPedido.length, total);
  carrinho = [];
  event.target.reset();
  document.getElementById("checkoutData").value = hojeIso;
  atualizarTela();
}

function tocarSomPedido() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const notas = [660, 880, 1170];
    notas.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + index * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.12 + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + index * 0.12);
      osc.stop(ctx.currentTime + index * 0.12 + 0.13);
    });
  } catch {
    // Audio pode estar bloqueado pelo navegador.
  }
}

function notificarNovoPedido(cliente, itens, total) {
  const toast = document.getElementById("orderToast");
  const titulo = document.getElementById("orderToastTitle");
  if (!toast || !titulo) return;
  titulo.innerText = `${cliente} • ${itens} item(ns) • ${dinheiro(total)}`;
  toast.classList.remove("hidden");
  tocarSomPedido();
  clearTimeout(notificarNovoPedido.timer);
  notificarNovoPedido.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 9000);
}

function pedidosNovosPendentes() {
  return pedidos.filter((pedido) => !pedido.aceitoEm && pedido.origem === "Loja do cliente");
}

function ativarCentralPedidos() {
  centralPedidosAtiva = true;
  solicitarPermissaoNotificacao();
  tocarSomPedido();
  renderCentralPedidos();
  alert("Central ativada. Deixe esta tela aberta para tocar quando chegar pedido novo.");
}

function iniciarAlarmePedido() {
  if (!centralPedidosAtiva || alertaPedidoTimer) return;
  tocarSomPedido();
  alertaPedidoTimer = setInterval(tocarSomPedido, 4500);
}

function pararAlarmePedido() {
  clearInterval(alertaPedidoTimer);
  alertaPedidoTimer = null;
}

function renderCentralPedidos() {
  const alvo = document.getElementById("centralPedidosNovos");
  if (!alvo) return;
  const novos = pedidosNovosPendentes();

  if (novos.length && centralPedidosAtiva) {
    iniciarAlarmePedido();
  } else {
    pararAlarmePedido();
  }

  if (!novos.length) {
    alvo.innerHTML = '<div class="empty-state">Nenhum pedido novo aguardando aceite.</div>';
    return;
  }

  alvo.innerHTML = novos.map((pedido) => {
    const total = pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita));
    return `
      <div class="new-order-card">
        <div class="new-order-head">
          <span>Novo pedido</span>
          <small>${tempoDesde(pedido.criadoEm)}</small>
        </div>
        <strong>${pedido.cliente}</strong>
        <p>${pedido.quantidade}x ${pedido.marmita} - ${dinheiro(total)}</p>
        <small>${pedido.formaRecebimento || "Retirar com Núbia"} - ${pedido.formaPagamento || "Pix"}</small>
        <div class="order-actions">
          <button type="button" onclick="aceitarPedido('${pedido.id}')">Aceitar pedido</button>
          <button type="button" onclick="enviarConfirmacao('${pedido.id}')">Chamar cliente</button>
          <button type="button" onclick="avancarEntrega('${pedido.id}')">Em preparo</button>
        </div>
      </div>
    `;
  }).join("");
}

function aceitarPedido(id) {
  pedidos = pedidos.map((pedido) => pedido.id === id ? {
    ...pedido,
    aceitoEm: new Date().toISOString(),
    statusEntrega: "Preparando"
  } : pedido);
  salvar("pedidos", pedidos);
  renderCentralPedidos();
  atualizarTela();
}

function cardCozinha(pedido, acaoPrimaria) {
  const total = pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita));
  return `
    <article class="kitchen-ticket">
      <span>${pedido.formaRecebimento || "Retirar com Núbia"}</span>
      <strong>${pedido.cliente}</strong>
      <p>${pedido.quantidade}x ${pedido.marmita}</p>
      <small>${dinheiro(total)} - ${tempoDesde(pedido.criadoEm)}</small>
      <div class="order-actions">
        ${acaoPrimaria}
        <button type="button" onclick="enviarConfirmacao('${pedido.id}')">Cliente</button>
      </div>
    </article>
  `;
}

function renderModoCozinha() {
  const novosEl = document.getElementById("cozinhaNovos");
  const preparoEl = document.getElementById("cozinhaPreparo");
  const prontosEl = document.getElementById("cozinhaProntos");
  if (!novosEl || !preparoEl || !prontosEl) return;

  const novos = pedidos.filter((pedido) => pedido.origem === "Loja do cliente" && !pedido.aceitoEm && pedido.status !== "Recusado");
  const preparo = pedidos.filter((pedido) => pedido.aceitoEm && (pedido.statusEntrega || "Preparando") === "Preparando");
  const prontos = pedidos.filter((pedido) => (pedido.statusEntrega || "") === "Pronto");

  novosEl.innerHTML = novos.length
    ? novos.map((pedido) => cardCozinha(pedido, `<button type="button" onclick="aceitarPedido('${pedido.id}')">Aceitar</button>`)).join("")
    : '<div class="empty-state">Nenhum pedido novo.</div>';

  preparoEl.innerHTML = preparo.length
    ? preparo.map((pedido) => cardCozinha(pedido, `<button type="button" onclick="avancarEntrega('${pedido.id}')">Marcar pronto</button>`)).join("")
    : '<div class="empty-state">Nada em preparo.</div>';

  prontosEl.innerHTML = prontos.length
    ? prontos.map((pedido) => cardCozinha(pedido, `<button type="button" onclick="avancarEntrega('${pedido.id}')">Finalizar</button>`)).join("")
    : '<div class="empty-state">Nenhum pronto.</div>';
}

function detectarPedidoNovo() {
  const maisNovo = pedidos[0]?.id || "";
  if (!maisNovo || maisNovo === ultimoPedidoConhecido) return;
  ultimoPedidoConhecido = maisNovo;
  localStorage.setItem("ultimoPedidoConhecido", maisNovo);
  const pedido = pedidos[0];
  if (pedido?.origem === "Loja do cliente") {
    const total = pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita));
    notificarNovoPedido(pedido.cliente, pedido.quantidade, total);
    if (centralPedidosAtiva) iniciarAlarmePedido();
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Novo pedido - Marmitas da Núbia", {
        body: `${pedido.cliente}: ${pedido.quantidade}x ${pedido.marmita}`
      });
    }
  }
}

function entrarAdmin(event) {
  event.preventDefault();
  const pin = document.getElementById("adminPin").value;
  if (pin !== "2026") {
    alert("PIN incorreto.");
    return;
  }
  configuracoes.adminLiberado = true;
  salvar("configuracoes", configuracoes);
  renderAdmin();
}

function sairAdmin() {
  configuracoes.adminLiberado = false;
  salvar("configuracoes", configuracoes);
  renderAdmin();
}

function renderAdmin() {
  const login = document.getElementById("adminLogin");
  const dashboard = document.getElementById("adminDashboard");
  if (!login || !dashboard) return;

  login.classList.toggle("hidden", !!configuracoes.adminLiberado);
  dashboard.classList.toggle("hidden", !configuracoes.adminLiberado);

  if (!configuracoes.adminLiberado) return;

  document.getElementById("adminPedidos").innerText = pedidos.length;
  document.getElementById("adminClientes").innerText = clientes.length;
  document.getElementById("adminPratos").innerText = pratos.length;
  document.getElementById("adminBanco").innerText = backendDisponivel ? "Backend" : "Local";
  document.getElementById("adminBackendStatus").innerText = backendDisponivel ? "sincronizado com servidor Node" : "rodando sem servidor";

  const pedidosHoje = pedidos.filter((pedido) => pedido.dataEntrega === hojeIso);
  const pendentes = pedidos.filter((pedido) => pedido.status === "Pendente");
  const receitaHoje = pedidosHoje.reduce((total, pedido) => total + pedido.quantidade * Number(pedido.valorUnitario || 0), 0);

  document.getElementById("adminResumo").innerHTML = `
    <div class="alert-item"><strong>${pedidosHoje.length} pedido(s) para hoje</strong><span>Receita prevista: ${dinheiro(receitaHoje)}</span></div>
    <div class="alert-item"><strong>${pendentes.length} pagamento(s) pendente(s)</strong><span>Acompanhe na aba Financeiro.</span></div>
    <div class="alert-item"><strong>${cotacoes.length} cotação(ões) cadastrada(s)</strong><span>Use a Cotação IA antes das compras.</span></div>
  `;

  renderMonitorPromocoes();
}

async function sincronizarBackendAgora() {
  await salvarEstadoBackend();
  await carregarEstadoBackend();
  await carregarMonitorPromocoes();
  atualizarTela();
  alert(backendDisponivel ? "Sincronizado com o backend local." : "Backend não está disponível nesta abertura.");
}

function renderMonitorPromocoes() {
  const alvo = document.getElementById("adminMonitorPromos");
  if (!alvo) return;

  if (!monitorPromocoes?.lastRun) {
    alvo.innerHTML = '<div class="empty-state">Nenhuma execução do monitor ainda.</div>';
    return;
  }

  const run = monitorPromocoes.lastRun;
  const dealsRun = monitorPromocoes.lastDealsRun || run.dailyDeals;
  const encontrados = run.results.filter((item) => item.bestFound);
  const tentativas = dealsRun?.summary?.attempts || 0;
  const ofertas = dealsRun?.summary?.deals || 0;
  const vazios = dealsRun?.summary?.blockedOrEmpty || [];
  alvo.innerHTML = `
    <div class="alert-item"><strong>Última execução</strong><span>${new Date(run.finishedAt).toLocaleString("pt-BR")}</span></div>
    <div class="alert-item"><strong>${tentativas || run.results.length} site(s) consultado(s)</strong><span>${ofertas} oferta(s) capturada(s) nas páginas dos mercados.</span></div>
    ${vazios.length ? `<div class="alert-item warning-line"><strong>Mercados sem preço legível</strong><span>${vazios.join(", ")}. O site pode bloquear robôs ou carregar ofertas por imagem/app.</span></div>` : ""}
    ${encontrados.slice(0, 5).map((item) => `
      <div class="alert-item">
        <strong>${item.item}: ${item.bestFound.raw}</strong>
        <span>${item.bestFound.mercado} • ${item.regiao}</span>
      </div>
    `).join("")}
  `;
}

async function rodarMonitorPromocoes() {
  const alvo = document.getElementById("adminMonitorPromos");
  if (alvo) alvo.innerHTML = '<div class="empty-state">IA entrando nos sites dos mercados e mapeando ofertas do dia. Isso pode levar alguns segundos...</div>';
  try {
    const resposta = await fetch(apiUrl("/api/monitor/promocoes/run"), { method: "POST" });
    if (!resposta.ok) throw new Error("Falha ao rodar monitor");
    await carregarMonitorPromocoes();
    renderMonitorPromocoes();
  } catch {
    if (alvo) alvo.innerHTML = '<div class="empty-state">Não consegui rodar o monitor. Abra pelo backend Node para usar esta função.</div>';
  }
}

function pedidosFiltrados() {
  const busca = document.getElementById("buscaPedidos")?.value.toLowerCase() || "";
  const status = document.getElementById("filtroStatus")?.value || "Todos";

  return pedidos.filter((pedido) => {
    const texto = `${pedido.cliente} ${pedido.telefone} ${pedido.marmita}`.toLowerCase();
    const combinaTexto = texto.includes(busca);
    const combinaStatus = status === "Todos" || pedido.status === status;
    return combinaTexto && combinaStatus;
  });
}

function mostrarPedidos() {
  const lista = document.getElementById("listaPedidos");
  const filtrados = pedidosFiltrados();

  if (!filtrados.length) {
    lista.innerHTML = '<div class="empty-state">Nenhum pedido encontrado.</div>';
    return;
  }

  lista.innerHTML = filtrados.map((pedido) => {
    const total = pedido.quantidade * Number(pedido.valorUnitario || 0);
    return `
      <article class="order-card">
        <div>
          <span class="badge ${pedido.status.toLowerCase()}">${pedido.status}</span>
          <h3>${pedido.cliente}</h3>
          <div class="order-meta">
            <span>${pedido.quantidade}x ${pedido.marmita}</span>
            <span>Entrega: ${formatarData(pedido.dataEntrega)}</span>
            <span>${pedido.formaRecebimento || "Retirar com Núbia"}</span>
            <span>${pedido.formaPagamento || "Pix"}</span>
            <span>${pedido.telefone || "Sem telefone"}</span>
            <span>${dinheiro(total)}</span>
          </div>
          ${pedido.observacao ? `<p>${pedido.observacao}</p>` : ""}
        </div>
        <div class="order-actions">
          <button type="button" onclick="enviarConfirmacao('${pedido.id}')">WhatsApp</button>
          <button type="button" onclick="alternarStatus('${pedido.id}')">Avançar status</button>
          <button class="danger" type="button" onclick="excluirPedido('${pedido.id}')">Excluir</button>
        </div>
      </article>
    `;
  }).join("");
}

function pedidosDoPeriodo(periodo) {
  const hoje = new Date(`${hojeIso}T00:00:00`);
  return pedidos.filter((pedido) => {
    if (periodo === "todos") return true;
    const data = new Date(`${pedido.dataEntrega || hojeIso}T00:00:00`);
    if (periodo === "dia") return pedido.dataEntrega === hojeIso;
    if (periodo === "semana") {
      const diff = Math.floor((hoje - data) / 86400000);
      return diff >= 0 && diff <= 6;
    }
    if (periodo === "mes") {
      return data.getMonth() === hoje.getMonth() && data.getFullYear() === hoje.getFullYear();
    }
    return true;
  });
}

function despesasDoPeriodo(periodo) {
  const hoje = new Date(`${hojeIso}T00:00:00`);
  return despesas.filter((despesa) => {
    if (periodo === "todos") return true;
    const data = new Date(`${despesa.data || hojeIso}T00:00:00`);
    if (periodo === "dia") return despesa.data === hojeIso;
    if (periodo === "semana") {
      const diff = Math.floor((hoje - data) / 86400000);
      return diff >= 0 && diff <= 6;
    }
    if (periodo === "mes") {
      return data.getMonth() === hoje.getMonth() && data.getFullYear() === hoje.getFullYear();
    }
    return true;
  });
}

function mostrarFinanceiro() {
  const periodo = document.getElementById("periodoFinanceiro")?.value || "dia";
  const pedidosPeriodo = pedidosDoPeriodo(periodo);
  const despesasPeriodo = despesasDoPeriodo(periodo);
  const receita = pedidosPeriodo.reduce((total, pedido) => total + pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita)), 0);
  const aberto = pedidosPeriodo.filter((pedido) => pedido.status === "Pendente").reduce((total, pedido) => total + pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita)), 0);
  const custoPratos = pedidosPeriodo.reduce((total, pedido) => total + pedido.quantidade * custoDoPrato(pedido.marmita), 0);
  const totalDespesas = despesasPeriodo.reduce((total, despesa) => total + Number(despesa.valor || 0), 0);
  const lucro = receita - custoPratos - totalDespesas;
  const totalPorPagamento = (forma) => pedidosPeriodo
    .filter((pedido) => (pedido.formaPagamento || "Pix") === forma)
    .reduce((total, pedido) => total + pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita)), 0);

  document.getElementById("receitaPeriodo").innerText = dinheiro(receita);
  document.getElementById("valorAberto").innerText = dinheiro(aberto);
  document.getElementById("custoPeriodo").innerText = dinheiro(custoPratos + totalDespesas);
  document.getElementById("lucroPeriodo").innerText = dinheiro(lucro);
  document.getElementById("totalPix").innerText = dinheiro(totalPorPagamento("Pix"));
  document.getElementById("totalCredito").innerText = dinheiro(totalPorPagamento("Cartão de crédito"));
  document.getElementById("totalDebito").innerText = dinheiro(totalPorPagamento("Cartão de débito"));
  document.getElementById("totalDinheiro").innerText = dinheiro(totalPorPagamento("Dinheiro"));

  const lista = document.getElementById("listaDespesas");
  if (!despesasPeriodo.length) {
    lista.innerHTML = '<div class="empty-state">Nenhuma despesa cadastrada neste período.</div>';
    return;
  }

  lista.innerHTML = despesasPeriodo.map((despesa) => `
    <div class="shopping-item">
      <div>
        <strong>${despesa.descricao}</strong>
        <span>${formatarData(despesa.data)} • ${dinheiro(despesa.valor)}</span>
      </div>
      <button class="danger" type="button" onclick="excluirDespesa('${despesa.id}')">Excluir</button>
    </div>
  `).join("");
}

function adicionarDespesa(event) {
  event.preventDefault();
  despesas.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    descricao: document.getElementById("despesaDescricao").value.trim(),
    valor: Number(document.getElementById("despesaValor").value || 0),
    data: document.getElementById("despesaData").value || hojeIso,
    criadoEm: new Date().toISOString()
  });
  salvar("despesas", despesas);
  event.target.reset();
  document.getElementById("despesaData").value = hojeIso;
  atualizarTela();
}

function excluirDespesa(id) {
  despesas = despesas.filter((despesa) => despesa.id !== id);
  salvar("despesas", despesas);
  atualizarTela();
}

function adicionarCotacao(event) {
  event.preventDefault();

  cotacoes.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    item: document.getElementById("cotacaoItem").value.trim(),
    categoria: document.getElementById("cotacaoCategoria").value,
    mercado: document.getElementById("cotacaoMercado").value,
    regiao: document.getElementById("cotacaoRegiao").value,
    preco: Number(document.getElementById("cotacaoPreco").value || 0),
    unidade: document.getElementById("cotacaoUnidade").value,
    data: document.getElementById("cotacaoData").value || hojeIso,
    fonte: document.getElementById("cotacaoFonte").value.trim(),
    criadoEm: new Date().toISOString()
  });

  salvar("cotacoes", cotacoes);
  event.target.reset();
  document.getElementById("cotacaoData").value = hojeIso;
  atualizarTela();
  trocarAba("cotacao");
}

function cotacoesPorItem() {
  return cotacoes.reduce((acc, cotacao) => {
    const chave = cotacao.item.toLowerCase();
    acc[chave] = acc[chave] || [];
    acc[chave].push(cotacao);
    return acc;
  }, {});
}

function melhoresCotacoes() {
  return Object.values(cotacoesPorItem()).map((grupo) => {
    const ordenado = [...grupo].sort((a, b) => Number(a.preco) - Number(b.preco));
    const melhor = ordenado[0];
    const pior = ordenado[ordenado.length - 1];
    return {
      ...melhor,
      economia: Number(pior?.preco || melhor.preco) - Number(melhor.preco),
      opcoes: grupo.length
    };
  }).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.item.localeCompare(b.item));
}

function diaSemana(dataIso) {
  if (!dataIso) return "-";
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(new Date(`${dataIso}T00:00:00`));
}

function cotacaoAnterior(cotacao) {
  return cotacoes
    .filter((item) => item.item.toLowerCase() === cotacao.item.toLowerCase() && item.id !== cotacao.id && item.data <= cotacao.data)
    .sort((a, b) => `${b.data}${b.criadoEm}`.localeCompare(`${a.data}${a.criadoEm}`))[0];
}

function analisarHistoricoPromocoes() {
  const melhores = melhoresCotacoes();
  const oportunidades = melhores.map((cotacao) => {
    const anterior = cotacaoAnterior(cotacao);
    const economia = anterior ? Number(anterior.preco) - Number(cotacao.preco) : 0;
    return {
      ...cotacao,
      anterior,
      economia,
      percentual: anterior && anterior.preco ? (economia / Number(anterior.preco)) * 100 : 0
    };
  }).filter((item) => item.economia > 0);

  const porDia = cotacoes.reduce((acc, cotacao) => {
    const dia = diaSemana(cotacao.data);
    acc[dia] = acc[dia] || { total: 0, count: 0 };
    acc[dia].total += Number(cotacao.preco || 0);
    acc[dia].count += 1;
    return acc;
  }, {});

  const melhorDia = Object.entries(porDia)
    .map(([dia, dados]) => ({ dia, media: dados.total / dados.count }))
    .sort((a, b) => a.media - b.media)[0]?.dia || "-";

  return {
    oportunidades,
    economiaTotal: oportunidades.reduce((total, item) => total + item.economia, 0),
    melhorDia
  };
}

function atualizarPromocoes() {
  const economiaEl = document.getElementById("economiaCotacao");
  if (!economiaEl) return;
  const analise = analisarHistoricoPromocoes();

  document.getElementById("economiaCotacao").innerText = dinheiro(analise.economiaTotal);
  document.getElementById("melhorDiaCompra").innerText = analise.melhorDia;
  document.getElementById("totalPromocoes").innerText = analise.oportunidades.length;
  document.getElementById("alertasPromocao").innerHTML = analise.oportunidades.length
    ? analise.oportunidades.map((item) => `
      <div class="alert-item">
        <strong>${item.item} está valendo a pena no ${item.mercado}</strong>
        <span>Agora ${dinheiro(item.preco)} / ${item.unidade}; antes ${dinheiro(item.anterior.preco)}. Economia de ${dinheiro(item.economia)} (${item.percentual.toFixed(1)}%).</span>
      </div>
    `).join("")
    : '<div class="empty-state">Ainda não há histórico suficiente para comparar promoções.</div>';
}

function analisarPromocoes() {
  atualizarPromocoes();
  trocarAba("cotacao");
}

function mostrarCotacoes() {
  const recomendacoes = document.getElementById("recomendacoesCotacao");
  const lista = document.getElementById("listaCotacoes");
  if (!recomendacoes || !lista) return;

  const melhores = melhoresCotacoes();

  recomendacoes.innerHTML = melhores.length
    ? melhores.map((item) => `
      <article class="quote-card">
        <span>${item.categoria}</span>
        <h3>${item.item}</h3>
        <strong>${item.mercado}</strong>
        <p>${item.regiao} • ${dinheiro(item.preco)} / ${item.unidade}</p>
        <small>${item.opcoes} cotação(ões) ${item.economia > 0 ? `• economia de ${dinheiro(item.economia)}` : ""}</small>
      </article>
    `).join("")
    : '<div class="empty-state">Cadastre cotações para a IA indicar o mercado mais barato por item.</div>';

  lista.innerHTML = cotacoes.length
    ? cotacoes.map((cotacao) => `
      <div class="shopping-item">
        <div>
          <strong>${cotacao.item}</strong>
          <span>${cotacao.mercado} • ${cotacao.regiao} • ${dinheiro(cotacao.preco)} / ${cotacao.unidade} • ${formatarData(cotacao.data)}</span>
          ${cotacao.fonte ? `<span>${cotacao.fonte}</span>` : ""}
        </div>
        <button class="danger" type="button" onclick="excluirCotacao('${cotacao.id}')">Excluir</button>
      </div>
    `).join("")
    : "";
  atualizarPromocoes();
}

function preencherRegioesCotacao() {
  const html = REGIOES_DF.map((regiao) => `<option value="${regiao}">${regiao}</option>`).join("");
  ["cotacaoRegiao", "pesquisaRegiaoPreco"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = html;
    select.value = "Recanto das Emas";
  });
}

function removerFotosAutomaticasAntigas() {
  let alterou = false;
  pratos = pratos.map((prato) => {
    if (String(prato.foto || "").includes("images.unsplash.com")) {
      alterou = true;
      return { ...prato, foto: "" };
    }
    return prato;
  });

  ["fotoSegunda", "fotoTerca", "fotoQuarta", "fotoQuinta", "fotoSexta"].forEach((chave) => {
    if (String(cardapio[chave] || "").includes("images.unsplash.com")) {
      cardapio[chave] = "";
      alterou = true;
    }
  });

  if (alterou) {
    salvar("pratos", pratos);
    salvar("cardapio", cardapio);
  }
}

async function pesquisarPrecoIA(event) {
  event.preventDefault();
  const item = document.getElementById("pesquisaItemPreco").value.trim();
  const regiao = document.getElementById("pesquisaRegiaoPreco").value;
  if (!item) return;

  const historico = cotacoes
    .filter((cotacao) => cotacao.item.toLowerCase().includes(item.toLowerCase()))
    .sort((a, b) => Number(a.preco) - Number(b.preco));
  const melhorHistorico = historico[0];
  const alvo = document.getElementById("resultadoPesquisaPreco");
  alvo.innerHTML = '<div class="empty-state">IA entrando nos sites dos mercados e lendo as ofertas do dia...</div>';

  let pesquisas = MERCADOS_COTACAO.map((mercado) => ({
    mercado,
    query: `${mercado} ${regiao} oferta preço ${item}`,
    url: `https://www.google.com/search?q=${encodeURIComponent(`${mercado} ${regiao} oferta preço ${item}`)}`,
    foundPrices: [],
    bestPrice: null
  }));

  try {
    const response = await fetch(apiUrl(`/api/price-search?item=${encodeURIComponent(item)}&regiao=${encodeURIComponent(regiao)}`), { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json();
      pesquisas = payload.pesquisas || pesquisas;
    }
  } catch {
    // Sem backend, mantém o modo de pesquisa assistida.
  }

  alvo.innerHTML = `
    ${melhorHistorico ? `
      <article class="quote-card best-quote">
        <span>Melhor no histórico</span>
        <h3>${melhorHistorico.item}</h3>
        <strong>${melhorHistorico.mercado}</strong>
        <p>${melhorHistorico.regiao} • ${dinheiro(melhorHistorico.preco)} / ${melhorHistorico.unidade}</p>
        <small>Última cotação: ${formatarData(melhorHistorico.data)}</small>
      </article>
    ` : `
      <article class="quote-card best-quote">
        <span>Sem histórico ainda</span>
        <h3>${item}</h3>
        <strong>Varredura nos mercados</strong>
        <p>A IA vai tentar ler as páginas de ofertas. Se o mercado publicar só imagem/app, ela avisa que não encontrou preço legível.</p>
      </article>
    `}
    ${pesquisas.map((resultado) => {
      const mercado = resultado.mercado;
      const query = resultado.query || `${mercado} ${regiao} oferta preço ${item}`;
      const precoEncontrado = resultado.bestPrice?.raw || "";
      const descricao = resultado.bestPrice?.description || "";
      const tentativas = resultado.attempts?.length || 0;
      const fonte = resultado.bestPrice?.sourceUrl || resultado.url || `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      return `
        <article class="quote-card ${precoEncontrado ? "best-quote" : ""}">
          <span>${precoEncontrado ? "Oferta capturada no site" : "Site sem preço legível"}</span>
          <h3>${mercado}</h3>
          <p>${regiao} • ${item}</p>
          ${precoEncontrado ? `<strong>${precoEncontrado}</strong><small>${descricao || "Encontrado automaticamente no site do mercado. Confirme antes de comprar."}</small>` : `<small>${tentativas ? `${tentativas} página(s) consultada(s), mas sem preço de ${item} em texto.` : "Preço não encontrado automaticamente."}</small>`}
          <div class="quote-card-actions">
            <button type="button" onclick="window.open('${fonte}', '_blank', 'noopener,noreferrer')">Ver fonte</button>
            <button type="button" onclick="preencherCotacaoRapida('${item.replace(/'/g, "\\'")}', '${mercado}', '${regiao}')">Registrar preço encontrado</button>
          </div>
        </article>
      `;
    }).join("")}
  `;

  trocarAba("cotacao");
}

function preencherCotacaoRapida(item, mercado, regiao) {
  document.getElementById("cotacaoItem").value = item;
  document.getElementById("cotacaoMercado").value = mercado;
  document.getElementById("cotacaoRegiao").value = regiao;
  document.getElementById("cotacaoData").value = hojeIso;
  document.getElementById("cotacaoPreco").focus();
}

async function mapearOfertasDoDia() {
  const alvo = document.getElementById("ofertasReaisDia");
  if (!alvo) return;
  alvo.innerHTML = '<div class="empty-state">IA entrando nos sites dos mercados e lendo as ofertas reais do dia...</div>';
  try {
    const response = await fetch(apiUrl("/api/ofertas-dia/run"), { method: "POST" });
    if (!response.ok) throw new Error("Falha ao mapear ofertas");
    const payload = await response.json();
    const deals = payload.run?.deals || [];
    const blocked = payload.run?.summary?.blockedOrEmpty || [];
    alvo.innerHTML = `
      <article class="quote-card best-quote">
        <span>Varredura real</span>
        <h3>${deals.length} oferta(s)</h3>
        <p>${payload.run?.summary?.attempts || 0} página(s) consultada(s) nos mercados.</p>
        <small>${blocked.length ? `Sem preço legível: ${blocked.join(", ")}` : "Todos os mercados retornaram alguma leitura."}</small>
      </article>
      ${deals.slice(0, 11).map((deal) => `
        <article class="quote-card ${deal.confidence === "alta" ? "best-quote" : ""}">
          <span>${deal.confidence === "alta" ? "Item monitorado" : "Oferta capturada"}</span>
          <h3>${deal.item}</h3>
          <strong>${deal.priceRaw}</strong>
          <p>${deal.mercado}</p>
          <small>${deal.descricao}</small>
          <div class="quote-card-actions">
            <button type="button" onclick="window.open('${deal.sourceUrl}', '_blank', 'noopener,noreferrer')">Ver fonte</button>
            <button type="button" onclick="preencherCotacaoRapida('${deal.item.replace(/'/g, "\\'")}', '${deal.mercado}', 'Recanto das Emas')">Registrar</button>
          </div>
        </article>
      `).join("")}
    `;
  } catch {
    alvo.innerHTML = '<div class="empty-state">Não consegui mapear as ofertas agora. Rode pelo backend Node e confira as credenciais/rede.</div>';
  }
}

function excluirCotacao(id) {
  cotacoes = cotacoes.filter((cotacao) => cotacao.id !== id);
  salvar("cotacoes", cotacoes);
  atualizarTela();
}

function popularCotacoesExemplo() {
  const itens = [
    "Peito de frango",
    "Carne bovina em cubos",
    "Linguiça calabresa",
    "Alface",
    "Couve",
    "Tomate",
    "Cenoura",
    "Batata",
    "Abobrinha"
  ];

  itens.forEach((item) => {
    document.getElementById("cotacaoItem").value = item;
  });

  alert("Use esta lista como base: peito de frango, carne bovina, linguiça, alface, couve, tomate, cenoura, batata e abobrinha. Registre os preços encontrados para a IA comparar.");
}

function abrirPesquisasMercados() {
  const consultas = [
    "Atacadão DIA-A-DIA ofertas Recanto das Emas",
    "Super Adega Atacadista ofertas Riacho Fundo",
    "Vivendas supermercado ofertas Recanto das Emas",
    "Tatico ofertas Riacho Fundo"
  ];

  consultas.forEach((consulta, index) => {
    setTimeout(() => {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(consulta)}`, "_blank", "noopener,noreferrer");
    }, index * 250);
  });
}

function enviarListaCotacaoWhatsApp() {
  const melhores = melhoresCotacoes();
  if (!melhores.length) {
    alert("Cadastre algumas cotações antes de gerar a lista inteligente.");
    return;
  }

  const porMercado = melhores.reduce((acc, item) => {
    acc[item.mercado] = acc[item.mercado] || [];
    acc[item.mercado].push(item);
    return acc;
  }, {});

  const mensagem = `Lista inteligente de compras - Marmitas da Núbia

${Object.entries(porMercado).map(([mercado, itens]) => `${mercado}
${itens.map((item) => `- ${item.item}: ${dinheiro(item.preco)} / ${item.unidade}`).join("\n")}`).join("\n\n")}`;

  abrirWhatsApp("", mensagem);
}

function mostrarEntregas() {
  const data = document.getElementById("filtroEntregaData")?.value || hojeIso;
  const grupos = {
    Preparando: document.getElementById("entregasPreparando"),
    Pronto: document.getElementById("entregasPronto"),
    Entregue: document.getElementById("entregasEntregue")
  };

  Object.values(grupos).forEach((el) => {
    if (el) el.innerHTML = "";
  });

  pedidos.filter((pedido) => pedido.dataEntrega === data).forEach((pedido) => {
    const statusEntrega = pedido.statusEntrega || (pedido.status === "Entregue" ? "Entregue" : "Preparando");
    const el = grupos[statusEntrega] || grupos.Preparando;
    const total = pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita));
    el.insertAdjacentHTML("beforeend", `
      <article class="delivery-card">
        <strong>${pedido.cliente}</strong>
        <span>${pedido.quantidade}x ${pedido.marmita}</span>
        <small>${pedido.formaRecebimento || "Retirar com Núbia"} • ${dinheiro(total)}</small>
        <div class="order-actions">
          <button type="button" onclick="avancarEntrega('${pedido.id}')">Avançar</button>
          <button type="button" onclick="avisarSaiuEntrega('${pedido.id}')">Avisar cliente</button>
        </div>
      </article>
    `);
  });

  Object.entries(grupos).forEach(([status, el]) => {
    if (el && !el.innerHTML) {
      el.innerHTML = `<div class="empty-state">Nenhum pedido em ${status.toLowerCase()}.</div>`;
    }
  });
}

function avancarEntrega(id) {
  const fluxo = ["Preparando", "Pronto", "Entregue"];
  pedidos = pedidos.map((pedido) => {
    if (pedido.id !== id) return pedido;
    const atual = pedido.statusEntrega || "Preparando";
    const proximo = fluxo[Math.min(fluxo.indexOf(atual) + 1, fluxo.length - 1)];
    return { ...pedido, statusEntrega: proximo, status: proximo === "Entregue" ? "Entregue" : pedido.status };
  });
  salvar("pedidos", pedidos);
  atualizarTela();
}

function avisarSaiuEntrega(id) {
  const pedido = pedidos.find((item) => item.id === id);
  if (!pedido) return;

  const mensagem = pedido.formaRecebimento === "Retirar com Núbia"
    ? `Olá, ${pedido.cliente}! Sua marmita já está ficando pronta para retirada com a Núbia. Assim que chegar, é só chamar.`
    : `Olá, ${pedido.cliente}! Sua marmita da Núbia já está pronta e vai sair para entrega. Obrigada pela preferência.`;

  abrirWhatsApp(pedido.telefone, mensagem);
}

function enviarPrimeiroPagamentoPendente() {
  const pedido = pedidos.find((item) => item.status === "Pendente" && item.telefone);
  if (!pedido) {
    alert("Não há pedidos pendentes com telefone cadastrado.");
    return;
  }

  const total = pedido.quantidade * Number(pedido.valorUnitario || precoDoPrato(pedido.marmita));
  const mensagem = `Olá, ${pedido.cliente}! Passando para lembrar com carinho do pagamento da sua encomenda da Marmitas da Núbia.

Pedido: ${pedido.quantidade}x ${pedido.marmita}
Valor: ${dinheiro(total)}

Quando puder, me confirma por aqui.`;

  abrirWhatsApp(pedido.telefone, mensagem);
}

function enviarPrimeiroPosVenda() {
  const pedido = pedidos.find((item) => item.status === "Entregue" && item.telefone);
  if (!pedido) {
    alert("Não há pedidos entregues com telefone cadastrado.");
    return;
  }

  const mensagem = `Olá, ${pedido.cliente}! Espero que tenha gostado da sua marmita.

Sua opinião ajuda muito a Núbia a continuar preparando tudo com capricho. Me conta o que achou?`;

  abrirWhatsApp(pedido.telefone, mensagem);
}

function alternarStatus(id) {
  const fluxo = ["Pendente", "Pago", "Entregue"];
  pedidos = pedidos.map((pedido) => {
    if (pedido.id !== id) return pedido;
    const proximo = fluxo[(fluxo.indexOf(pedido.status) + 1) % fluxo.length];
    return { ...pedido, status: proximo };
  });
  salvar("pedidos", pedidos);
  atualizarTela();
}

function excluirPedido(id) {
  if (!confirm("Excluir este pedido?")) return;
  pedidos = pedidos.filter((pedido) => pedido.id !== id);
  salvar("pedidos", pedidos);
  atualizarTela();
}

function enviarConfirmacao(id) {
  const pedido = pedidos.find((item) => item.id === id);
  if (!pedido) return;

  const total = pedido.quantidade * Number(pedido.valorUnitario || 0);
  const mensagem = `Olá, ${pedido.cliente}! Seu pedido nas Marmitas da Núbia ficou assim:

${pedido.quantidade}x ${pedido.marmita}
Entrega: ${formatarData(pedido.dataEntrega)}
Valor: ${dinheiro(total)}
Status: ${pedido.status}

Pode confirmar para mim, por favor?`;

  abrirWhatsApp(pedido.telefone, mensagem);
}

function abrirPrimeiroPendente() {
  const pedido = pedidos.find((item) => item.status === "Pendente" && item.telefone);
  if (!pedido) {
    alert("Não há pedidos pendentes com telefone cadastrado.");
    return;
  }
  enviarConfirmacao(pedido.id);
}

function adicionarIngrediente(event) {
  if (event) event.preventDefault();

  const nome = document.getElementById("ingrediente").value.trim();
  const situacao = document.getElementById("situacaoIngrediente").value;

  if (!nome) return;

  ingredientes.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    nome,
    situacao
  });

  salvar("ingredientes", ingredientes);
  event.target.reset();
  atualizarTela();
}

function mostrarIngredientes() {
  const lista = document.getElementById("listaIngredientes");

  if (!ingredientes.length) {
    lista.innerHTML = '<div class="empty-state">Nenhum item de compra cadastrado.</div>';
    return;
  }

  lista.innerHTML = ingredientes.map((item) => `
    <div class="shopping-item ${item.situacao === "Comprado" ? "done" : ""}">
      <div>
        <strong>${item.nome}</strong>
        <span>${item.situacao}</span>
      </div>
      <div class="order-actions">
        <button type="button" onclick="alternarIngrediente('${item.id}')">${item.situacao === "Comprado" ? "Marcar pendente" : "Marcar comprado"}</button>
        <button class="danger" type="button" onclick="excluirIngrediente('${item.id}')">Excluir</button>
      </div>
    </div>
  `).join("");
}

function alternarIngrediente(id) {
  ingredientes = ingredientes.map((item) => {
    if (item.id !== id) return item;
    return { ...item, situacao: item.situacao === "Comprado" ? "Falta comprar" : "Comprado" };
  });
  salvar("ingredientes", ingredientes);
  atualizarTela();
}

function excluirIngrediente(id) {
  ingredientes = ingredientes.filter((item) => item.id !== id);
  salvar("ingredientes", ingredientes);
  atualizarTela();
}

function gerarProducao() {
  const data = document.getElementById("filtroData").value || hojeIso;
  const pedidosDoDia = pedidos.filter((pedido) => pedido.dataEntrega === data);
  const producao = pedidosDoDia.reduce((acc, pedido) => {
    acc[pedido.marmita] = (acc[pedido.marmita] || 0) + pedido.quantidade;
    return acc;
  }, {});

  const alvo = document.getElementById("producaoSemana");
  if (!Object.keys(producao).length) {
    alvo.innerHTML = "Nenhum pedido encontrado para a data selecionada.";
    return;
  }

  alvo.innerHTML = Object.entries(producao).map(([marmita, quantidade]) => `
    <div class="menu-day">
      <span>${marmita}</span>
      <strong>${quantidade} unidades</strong>
    </div>
  `).join("");
}

function atualizarResumo() {
  const data = document.getElementById("filtroData")?.value || hojeIso;
  const pedidosDoDia = pedidos.filter((pedido) => pedido.dataEntrega === data);
  const totalMarmitas = pedidos.reduce((total, pedido) => total + pedido.quantidade, 0);
  const marmitasHoje = pedidosDoDia.reduce((total, pedido) => total + pedido.quantidade, 0);
  const faturamento = pedidos.reduce((total, pedido) => total + pedido.quantidade * Number(pedido.valorUnitario || 0), 0);
  const pendentesPagamento = pedidos.filter((pedido) => pedido.status === "Pendente").length;
  const comprasPendentes = ingredientes.filter((item) => item.situacao === "Falta comprar").length;

  document.getElementById("totalPedidos").innerText = pedidos.length;
  document.getElementById("pedidosHoje").innerText = `${pedidosDoDia.length} para ${formatarData(data)}`;
  document.getElementById("totalMarmitas").innerText = totalMarmitas;
  document.getElementById("marmitasHoje").innerText = `${marmitasHoje} para ${formatarData(data)}`;
  document.getElementById("faturamento").innerText = dinheiro(faturamento);
  document.getElementById("ticketMedio").innerText = `Ticket médio ${dinheiro(pedidos.length ? faturamento / pedidos.length : 0)}`;
  document.getElementById("pendencias").innerText = pendentesPagamento + comprasPendentes;
}

function atualizarAlertas() {
  const comprasPendentes = ingredientes.filter((item) => item.situacao === "Falta comprar");
  const pedidosPendentes = pedidos.filter((pedido) => pedido.status === "Pendente");
  const recompras = clientesParaRecompra();
  const retomar = clientes.filter((cliente) => !dadosCliente(cliente).ativo);

  const alertas = [
    comprasPendentes.length && {
      titulo: `${comprasPendentes.length} item(ns) de compra pendente(s)`,
      texto: comprasPendentes.map((item) => item.nome).slice(0, 4).join(", ")
    },
    pedidosPendentes.length && {
      titulo: `${pedidosPendentes.length} pedido(s) aguardando pagamento`,
      texto: "Use a confirmação por WhatsApp para acelerar a resposta."
    },
    recompras.length && {
      titulo: `${recompras.length} cliente(s) elegível(is) para recompra`,
      texto: `Clientes com pelo menos ${automacoes.minimoRecompra} marmitas no histórico.`
    },
    retomar.length && {
      titulo: `${retomar.length} cliente(s) sem pedido há 25 dias`,
      texto: "Use a aba Clientes para retomar o contato com uma mensagem delicada."
    }
  ].filter(Boolean);

  document.getElementById("alertasOperacao").innerHTML = alertas.length
    ? alertas.map((alerta) => `<div class="alert-item"><strong>${alerta.titulo}</strong><span>${alerta.texto}</span></div>`).join("")
    : '<div class="empty-state">Nenhuma pendência crítica no momento.</div>';
}

function clientesParaRecompra() {
  const mapa = new Map();

  pedidos.forEach((pedido) => {
    const chave = limparTelefone(pedido.telefone) || pedido.cliente.toLowerCase();
    if (!chave) return;
    const atual = mapa.get(chave) || {
      cliente: pedido.cliente,
      telefone: pedido.telefone,
      quantidade: 0,
      ultimoPedido: pedido.dataEntrega,
      marmitas: new Set()
    };
    atual.quantidade += pedido.quantidade;
    atual.ultimoPedido = pedido.dataEntrega > atual.ultimoPedido ? pedido.dataEntrega : atual.ultimoPedido;
    atual.marmitas.add(pedido.marmita);
    mapa.set(chave, atual);
  });

  return Array.from(mapa.values())
    .filter((cliente) => cliente.quantidade >= Number(automacoes.minimoRecompra || 5))
    .sort((a, b) => b.quantidade - a.quantidade)
    .map((cliente) => ({ ...cliente, marmitas: Array.from(cliente.marmitas) }));
}

function mensagemRecompra(cliente) {
  return `Olá, ${cliente.cliente}! Tudo bem?

Vi aqui que você costuma encomendar marmitas com a gente. Quer que eu reserve suas marmitas para a próxima semana?

Posso montar o pedido com base no seu costume ou te enviar o cardápio atualizado.`;
}

function gerarRecomprasWhatsApp() {
  const fila = clientesParaRecompra();
  const alvo = document.getElementById("filaRecompra");

  if (!fila.length) {
    alvo.innerHTML = '<div class="empty-state">Nenhum cliente atingiu a quantidade mínima para recompra ainda.</div>';
    trocarAba("automacoes");
    return;
  }

  alvo.innerHTML = fila.map((cliente, index) => `
    <article class="order-card">
      <div>
        <span class="badge pendente">Recompra</span>
        <h3>${cliente.cliente}</h3>
        <div class="order-meta">
          <span>${cliente.quantidade} marmitas no histórico</span>
          <span>Último pedido: ${formatarData(cliente.ultimoPedido)}</span>
          <span>${cliente.telefone || "Sem telefone"}</span>
        </div>
      </div>
      <div class="order-actions">
        <button type="button" onclick="enviarRecompra(${index})">Enviar WhatsApp</button>
      </div>
    </article>
  `).join("");

  trocarAba("automacoes");
}

function enviarRecompra(index) {
  const cliente = clientesParaRecompra()[index];
  if (!cliente) return;
  abrirWhatsApp(cliente.telefone, mensagemRecompra(cliente));
}

function salvarAutomacoes() {
  automacoes = {
    ...automacoes,
    minimoRecompra: Number(document.getElementById("minimoRecompra").value || 5),
    diaRecompra: Number(document.getElementById("diaRecompra").value || 5),
    horaRecompra: document.getElementById("horaRecompra").value || "19:00"
  };
  salvar("automacoes", automacoes);
  atualizarTela();
  alert("Automação salva. Se o sistema estiver aberto no horário configurado, ele exibirá o lembrete.");
}

function verificarNotificacaoRecompra() {
  const agora = new Date();
  const dia = agora.getDay();
  const horaAtual = agora.toTimeString().slice(0, 5);
  const chaveHoje = agora.toISOString().slice(0, 10);

  if (dia !== Number(automacoes.diaRecompra) || horaAtual < automacoes.horaRecompra || automacoes.ultimaNotificacao === chaveHoje) {
    return;
  }

  const fila = clientesParaRecompra();
  if (!fila.length) return;

  automacoes.ultimaNotificacao = chaveHoje;
  salvar("automacoes", automacoes);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Marmitas da Núbia", {
      body: `${fila.length} cliente(s) para chamar no WhatsApp hoje.`
    });
  }
}

function solicitarPermissaoNotificacao() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission();
}

function enviarComprasWhatsApp() {
  const pendentes = ingredientes.filter((item) => item.situacao === "Falta comprar");
  const mensagem = pendentes.length
    ? `Lista de compras pendentes - Marmitas da Núbia:\n\n${pendentes.map((item) => `- ${item.nome}`).join("\n")}`
    : "A lista de compras está em dia.";

  abrirWhatsApp("", mensagem);
}

function gerarResumoWhatsApp() {
  const data = document.getElementById("filtroData")?.value || hojeIso;
  const pedidosDoDia = pedidos.filter((pedido) => pedido.dataEntrega === data);
  const totalMarmitas = pedidosDoDia.reduce((total, pedido) => total + pedido.quantidade, 0);
  const faturamentoDia = pedidosDoDia.reduce((total, pedido) => total + pedido.quantidade * Number(pedido.valorUnitario || 0), 0);
  const comprasPendentes = ingredientes.filter((item) => item.situacao === "Falta comprar").length;

  const mensagem = `Resumo operacional - Marmitas da Núbia
Data: ${formatarData(data)}

Pedidos: ${pedidosDoDia.length}
Marmitas: ${totalMarmitas}
Faturamento previsto: ${dinheiro(faturamentoDia)}
Compras pendentes: ${comprasPendentes}

Produção:
${document.getElementById("producaoSemana").innerText}`;

  abrirWhatsApp("", mensagem);
}

function exportarPedidosCsv() {
  const cabecalho = ["cliente", "telefone", "marmita", "quantidade", "valor_unitario", "data_entrega", "status", "observacao"];
  const linhas = pedidos.map((pedido) => cabecalho.map((campo) => {
    const chave = campo.replace("_unitario", "Unitario").replace("_entrega", "Entrega");
    const valor = pedido[chave] ?? "";
    return `"${String(valor).replace(/"/g, '""')}"`;
  }).join(","));

  baixarArquivo(`pedidos-marmitas-da-nubia-${hojeIso}.csv`, [cabecalho.join(","), ...linhas].join("\n"), "text/csv;charset=utf-8");
}

function exportarBackup() {
  baixarArquivo(`backup-marmitas-da-nubia-${hojeIso}.json`, JSON.stringify({
    pedidos,
    clientes,
    pratos,
    despesas,
    cotacoes,
    ingredientes,
    cardapio,
    automacoes,
    configuracoes,
    exportadoEm: new Date().toISOString()
  }, null, 2));
}

function trocarAba(id) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === id));
  document.querySelectorAll(".tab-page").forEach((page) => page.classList.toggle("active", page.id === id));
  const tab = document.querySelector(`.sidebar-more .tab[data-tab="${id}"]`);
  if (tab) {
    const details = tab.closest("details");
    if (details) details.open = true;
  }
}

function aplicarRotaInicial() {
  const rota = window.location.pathname.toLowerCase();
  if (rota.includes("/loja")) {
    document.body.classList.add("mode-store");
    document.body.classList.remove("mode-admin");
    trocarAba("loja");
    return;
  }
  if (rota.includes("/admin")) {
    document.body.classList.add("mode-admin");
    document.body.classList.remove("mode-store");
    trocarAba("admin");
    return;
  }
  document.body.classList.remove("mode-store", "mode-admin");
  trocarAba("painel");
}

function atualizarLogo(event) {
  const arquivo = event.target.files?.[0];
  if (!arquivo) return;

  const reader = new FileReader();
  reader.onload = () => {
    configuracoes.logo = reader.result;
    salvar("configuracoes", configuracoes);
    aplicarLogo();
  };
  reader.readAsDataURL(arquivo);
}

function aplicarLogo() {
  const marca = document.getElementById("brandMark");
  if (configuracoes.logo) {
    marca.innerHTML = `<img src="${configuracoes.logo}" alt="Logo Marmitas da Núbia">`;
  } else {
    marca.innerHTML = '<img src="assets/logo-nubia.png" alt="Logo Núbia Marmitas">';
  }
}

function preencherAutomacoes() {
  document.getElementById("minimoRecompra").value = automacoes.minimoRecompra || 5;
  document.getElementById("diaRecompra").value = automacoes.diaRecompra || 5;
  document.getElementById("horaRecompra").value = automacoes.horaRecompra || "19:00";
}

function preencherConfiguracoesWhatsApp() {
  const campo = document.getElementById("whatsappDonaNubia");
  const status = document.getElementById("whatsappStatus");
  const apiStatus = document.getElementById("whatsappApiStatus");
  if (!campo || !status) return;
  if (!configuracoes.whatsappNubia) {
    configuracoes.whatsappNubia = WHATSAPP_NUBIA_PADRAO;
    salvar("configuracoes", configuracoes);
  }
  campo.value = whatsappNubia();
  status.innerText = `Pedidos enviados para: ${whatsappNubia()}`;
  if (apiStatus) {
    if (whatsappApi?.ready) {
      apiStatus.innerHTML = '<div class="alert-item"><strong>WhatsApp automático ativo</strong><span>Pedidos podem ser enviados pelo backend.</span></div>';
    } else {
      const faltando = whatsappApi?.missing?.join(", ") || "credenciais do provedor";
      apiStatus.innerHTML = `<div class="alert-item warning-line"><strong>Fallback por abertura do WhatsApp</strong><span>Para envio 100% automático, configure: ${faltando}.</span></div>`;
    }
  }
}

function salvarConfiguracoesWhatsApp(event) {
  event.preventDefault();
  const telefone = limparTelefone(document.getElementById("whatsappDonaNubia").value);
  if (telefone.length < 10) {
    alert("Informe o WhatsApp com DDD.");
    return;
  }
  configuracoes.whatsappNubia = telefone;
  salvar("configuracoes", configuracoes);
  preencherConfiguracoesWhatsApp();
  alert("WhatsApp da Núbia salvo para receber os pedidos.");
}

async function testarWhatsAppAutomatico() {
  const apiStatus = document.getElementById("whatsappApiStatus");
  if (apiStatus) {
    apiStatus.innerHTML = '<div class="empty-state">Enviando teste automático para o WhatsApp da Núbia...</div>';
  }
  try {
    const response = await fetch(apiUrl("/api/whatsapp/test"), { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.result?.reason || payload.error || "Envio automático indisponível.");
    }
    await carregarStatusWhatsApp();
    preencherConfiguracoesWhatsApp();
    alert("Teste enviado automaticamente para o WhatsApp da Núbia.");
  } catch (error) {
    if (apiStatus) {
      apiStatus.innerHTML = `<div class="alert-item warning-line"><strong>Envio automático ainda não ativo</strong><span>${error.message}</span></div>`;
    }
  }
}

function atualizarTela() {
  mostrarLojaCliente();
  mostrarCardapio();
  mostrarPedidos();
  mostrarClientes();
  mostrarPratos();
  mostrarIngredientes();
  mostrarCotacoes();
  mostrarEntregas();
  mostrarFinanceiro();
  gerarProducao();
  atualizarResumo();
  atualizarAlertas();
  renderAdmin();
  renderCentralPedidos();
  renderModoCozinha();
  atualizarLinkPedido();
  verificarNotificacaoRecompra();
}

async function sincronizarPedidosEmTempoReal() {
  const qtdAntes = pedidos.length;
  await carregarEstadoBackend();
  if (pedidos.length > qtdAntes) {
    detectarPedidoNovo();
  }
  atualizarTela();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => trocarAba(tab.dataset.tab));
});

document.getElementById("formCardapio").addEventListener("submit", salvarCardapio);
document.getElementById("novoPedido").addEventListener("submit", adicionarPedido);
document.getElementById("formCheckoutCliente").addEventListener("submit", finalizarCompraCliente);
document.getElementById("formAdmin").addEventListener("submit", entrarAdmin);
document.getElementById("formConfiguracoesWhatsApp").addEventListener("submit", salvarConfiguracoesWhatsApp);
document.getElementById("formCliente").addEventListener("submit", adicionarCliente);
document.getElementById("formPrato").addEventListener("submit", adicionarPrato);
document.getElementById("formDespesa").addEventListener("submit", adicionarDespesa);
document.getElementById("formCotacao").addEventListener("submit", adicionarCotacao);
document.getElementById("formPesquisaPreco").addEventListener("submit", pesquisarPrecoIA);
document.getElementById("formIngrediente").addEventListener("submit", adicionarIngrediente);
document.getElementById("buscaPedidos").addEventListener("input", mostrarPedidos);
document.getElementById("filtroStatus").addEventListener("change", mostrarPedidos);
document.getElementById("buscaClientes").addEventListener("input", mostrarClientes);
document.getElementById("filtroClientes").addEventListener("change", mostrarClientes);
document.getElementById("filtroData").addEventListener("change", atualizarTela);
document.getElementById("filtroEntregaData").addEventListener("change", mostrarEntregas);
document.getElementById("periodoFinanceiro").addEventListener("change", mostrarFinanceiro);
document.getElementById("marmita").addEventListener("change", preencherPedidoPorPrato);
document.getElementById("logoInput").addEventListener("change", atualizarLogo);

async function iniciarApp() {
  await iniciarBancoLocal();
  await carregarEstadoBackend();
  await carregarMonitorPromocoes();
  await carregarStatusWhatsApp();
  document.getElementById("dataEntrega").value = hojeIso;
  document.getElementById("checkoutData").value = hojeIso;
  document.getElementById("filtroData").value = hojeIso;
  document.getElementById("filtroEntregaData").value = hojeIso;
  document.getElementById("despesaData").value = hojeIso;
  document.getElementById("cotacaoData").value = hojeIso;
  preencherRegioesCotacao();
  deduplicarPratos();
  removerPratosIndesejados();
  garantirPratosFixos();
  removerFotosAutomaticasAntigas();
  aplicarNumeroTesteWhatsApp();
  aplicarLogo();
  preencherAutomacoes();
  preencherConfiguracoesWhatsApp();
  solicitarPermissaoNotificacao();
  atualizarTela();
  aplicarRotaInicial();
  setInterval(verificarNotificacaoRecompra, 60000);
  setInterval(sincronizarPedidosEmTempoReal, 5000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

iniciarApp();
