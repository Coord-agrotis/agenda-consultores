const STORAGE_KEY = "agenda-consultores-data";

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { consultores: [], empresas: [], allocations: {}, ferias: {}, contratos: {}, status: {} };
  const data = JSON.parse(raw);
  if (data.clientes && !data.empresas) {
    data.empresas = data.clientes;
    delete data.clientes;
    Object.values(data.allocations || {}).forEach((week) => {
      Object.values(week).forEach((allocs) => {
        allocs.forEach((a) => {
          if (a.cliente && !a.empresa) {
            a.empresa = a.cliente;
            delete a.cliente;
          }
        });
      });
    });
  }
  if (!data.empresas) data.empresas = [];
  if (!data.ferias) data.ferias = {};
  if (!data.contratos) data.contratos = {};
  if (!data.status) data.status = {};
  Object.keys(data.ferias).forEach((consultor) => {
    if (data.ferias[consultor].dataBase && !data.contratos[consultor]) {
      data.contratos[consultor] = data.ferias[consultor].dataBase;
    }
  });
  return data;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadData();

// --- Week handling (ISO week, key = "YYYY-WW") ---
let currentWeekStart = getStartOfWeek(new Date());
let viewMode = "semana";
let filtroConsultorAtual = "todos";

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey(date) {
  const d = new Date(date);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.round((firstThursday - target.valueOf()) / (7 * 24 * 3600 * 1000));
  return `${d.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function formatWeekLabel(start) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${fmt(start)} - ${fmt(end)} (${weekKey(start)})`;
}

// --- Ferias helpers ---
const MS_DAY = 24 * 3600 * 1000;
const DIREITO_DIAS = 30;

function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function diasEntre(inicio, fim) {
  return Math.round((fim - inicio) / MS_DAY) + 1;
}

function getFeriasConsultor(consultor) {
  if (!state.ferias[consultor]) state.ferias[consultor] = { periodos: [] };
  return state.ferias[consultor];
}

function getVencimentoContrato(consultor) {
  return state.contratos[consultor] || null;
}

function getStatusConsultor(consultor) {
  if (!state.status[consultor]) state.status[consultor] = { ativo: true, dataRescisao: null };
  return state.status[consultor];
}

function isConsultorAtivo(consultor) {
  return getStatusConsultor(consultor).ativo;
}

function setStatusConsultor(consultor, ativo) {
  const status = getStatusConsultor(consultor);
  status.ativo = ativo;
  if (ativo) status.dataRescisao = null;
  saveData();
  render();
}

function setDataRescisao(consultor, data) {
  getStatusConsultor(consultor).dataRescisao = data;
  saveData();
}

function getConsultoresAtivos() {
  return state.consultores.filter((c) => isConsultorAtivo(c));
}

function setVencimentoContrato(consultor, data) {
  state.contratos[consultor] = data;
  saveData();
  renderFerias();
  renderFeriasResumo();
  renderDashboard();
}

function getCiclosConsultor(consultor) {
  const info = getFeriasConsultor(consultor);
  const dataBase = getVencimentoContrato(consultor);
  if (!dataBase) return [];
  const base = parseDate(dataBase);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ciclos = [];
  let n = 0;
  while (n < 50) {
    const inicio = addYears(base, n);
    const fim = new Date(addYears(base, n + 1) - MS_DAY);
    let usados = 0;
    info.periodos.forEach((p) => {
      const pIni = parseDate(p.inicio);
      const pFim = parseDate(p.fim);
      const overlapIni = pIni > inicio ? pIni : inicio;
      const overlapFim = pFim < fim ? pFim : fim;
      if (overlapFim >= overlapIni) usados += diasEntre(overlapIni, overlapFim);
    });
    const saldo = DIREITO_DIAS - usados;
    const status = fim < now ? "passado" : inicio <= now && fim >= now ? "atual" : "futuro";
    let alerta = { texto: `${saldo} dias`, nivel: "ok" };
    if (status === "passado" && saldo > 0) alerta = { texto: `${saldo} dias vencidos`, nivel: "danger" };
    else if (status === "passado") alerta = { texto: "Completo", nivel: "ok" };
    else if (status === "atual" && saldo <= 0) alerta = { texto: "Sem saldo", nivel: "danger" };
    else if (status === "atual" && saldo <= 5) alerta = { texto: `Apenas ${saldo} dias`, nivel: "warn" };
    ciclos.push({ num: n + 1, inicio, fim, usados, saldo, status, alerta });
    if (inicio > now) break;
    n++;
  }
  return ciclos;
}

function isConsultorDeFeriasNaSemana(consultor, weekStart) {
  const info = getFeriasConsultor(consultor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return info.periodos.some((p) => {
    const pIni = parseDate(p.inicio);
    const pFim = parseDate(p.fim);
    return pIni <= weekEnd && pFim >= weekStart;
  });
}

function isConsultorDeFeriasHoje(consultor) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const info = getFeriasConsultor(consultor);
  return info.periodos.some((p) => {
    const pIni = parseDate(p.inicio);
    const pFim = parseDate(p.fim);
    return pIni <= hoje && pFim >= hoje;
  });
}

function getConsultoresFiltrados() {
  const ativos = getConsultoresAtivos();
  if (filtroConsultorAtual === "todos") return ativos;
  return ativos.filter((c) => c === filtroConsultorAtual);
}

// --- Alloc form toggle state ---
const openAllocForms = new Set();
function formKey(weekKeyStr, consultor) {
  return `${weekKeyStr}__${consultor}`;
}

function renderAllocControl(container, weekKeyStr, consultor, compact) {
  if (state.empresas.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "Cadastre empresas para alocar.";
    container.appendChild(hint);
    return;
  }

  const fk = formKey(weekKeyStr, consultor);

  if (!openAllocForms.has(fk)) {
    const btn = document.createElement("button");
    btn.className = "add-agenda-btn";
    btn.textContent = "+";
    btn.title = "Adicionar agenda";
    btn.onclick = () => {
      openAllocForms.add(fk);
      render();
    };
    container.appendChild(btn);
    return;
  }

  const form = document.createElement("div");
  form.className = compact ? "add-alloc-form periodo-cell-form" : "add-alloc-form";

  const empresaSelect = document.createElement("select");
  empresaSelect.multiple = true;
  empresaSelect.size = Math.min(state.empresas.length, compact ? 4 : 5);
  state.empresas.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = e;
    empresaSelect.appendChild(opt);
  });

  const modalidadeSelect = document.createElement("select");
  ["presencial", "remoto"].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m === "presencial" ? "Presencial" : "Remoto";
    modalidadeSelect.appendChild(opt);
  });

  const addBtn = document.createElement("button");
  addBtn.textContent = compact ? "+" : "Alocar";
  addBtn.title = "Ctrl/Cmd + clique para selecionar varias empresas";
  addBtn.onclick = () => {
    const selecionadas = Array.from(empresaSelect.selectedOptions).map((o) => o.value);
    openAllocForms.delete(fk);
    addAllocacoes(weekKeyStr, consultor, selecionadas, modalidadeSelect.value);
  };

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancelar";
  cancelBtn.onclick = () => {
    openAllocForms.delete(fk);
    render();
  };

  form.appendChild(empresaSelect);
  if (!compact) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "Ctrl/Cmd + clique para selecionar varias empresas";
    form.appendChild(hint);
  }
  form.appendChild(modalidadeSelect);
  form.appendChild(addBtn);
  form.appendChild(cancelBtn);
  container.appendChild(form);
}

// --- Rendering ---
function render() {
  document.getElementById("weekLabel").textContent = formatWeekLabel(currentWeekStart);
  renderConsultoresList();
  renderChipList("empresaList", state.empresas, removeEmpresa);
  renderFiltroConsultor();
  if (viewMode === "semana") {
    renderSchedule();
    renderResumoSemana();
  } else {
    renderPeriodo();
    document.getElementById("sumCards").innerHTML = "";
  }
  renderFerias();
  renderFeriasResumo();
  renderDashboard();
  saveData();
}

function renderFiltroConsultor() {
  const select = document.getElementById("filtroConsultor");
  const valorAtual = select.value || filtroConsultorAtual;
  const ativos = getConsultoresAtivos();
  select.innerHTML = `<option value="todos">Todos os consultores</option>`;
  ativos.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  if (ativos.includes(valorAtual) || valorAtual === "todos") {
    select.value = valorAtual;
    filtroConsultorAtual = valorAtual;
  } else {
    select.value = "todos";
    filtroConsultorAtual = "todos";
  }
}

function renderChipList(containerId, items, onRemove) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML = `<span class="empty-hint">Nenhum cadastrado ainda.</span>`;
    return;
  }
  items.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(item)}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "x";
    btn.onclick = () => onRemove(item);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function renderConsultoresList() {
  const container = document.getElementById("consultorList");
  container.innerHTML = "";

  if (state.consultores.length === 0) {
    container.innerHTML = `<span class="empty-hint">Nenhum consultor cadastrado ainda.</span>`;
    return;
  }

  state.consultores.forEach((consultor) => {
    const status = getStatusConsultor(consultor);
    const row = document.createElement("div");
    row.className = "consultor-row";

    const nome = document.createElement("span");
    nome.className = "consultor-nome";
    nome.textContent = consultor;

    const statusSelect = document.createElement("select");
    ["ativo", "inativo"].forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v === "ativo" ? "Ativo" : "Inativo";
      statusSelect.appendChild(opt);
    });
    statusSelect.value = status.ativo ? "ativo" : "inativo";
    statusSelect.onchange = () => setStatusConsultor(consultor, statusSelect.value === "ativo");

    const lbl = document.createElement("span");
    lbl.className = "consultor-contrato-lbl";
    lbl.textContent = "Vencimento do contrato:";

    const dataInput = document.createElement("input");
    dataInput.type = "date";
    if (state.contratos[consultor]) dataInput.value = state.contratos[consultor];
    dataInput.onchange = () => setVencimentoContrato(consultor, dataInput.value);

    row.appendChild(nome);
    row.appendChild(statusSelect);

    if (!status.ativo) {
      const rescisaoLbl = document.createElement("span");
      rescisaoLbl.className = "consultor-contrato-lbl";
      rescisaoLbl.textContent = "Data de rescisao:";
      const rescisaoInput = document.createElement("input");
      rescisaoInput.type = "date";
      if (status.dataRescisao) rescisaoInput.value = status.dataRescisao;
      rescisaoInput.onchange = () => setDataRescisao(consultor, rescisaoInput.value);
      row.appendChild(rescisaoLbl);
      row.appendChild(rescisaoInput);
    }

    row.appendChild(lbl);
    row.appendChild(dataInput);

    const chip = document.createElement("div");
    chip.className = "chip";
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "x";
    removeBtn.onclick = () => removeConsultor(consultor);
    chip.appendChild(removeBtn);
    row.appendChild(chip);

    container.appendChild(row);
  });
}

function renderSchedule() {
  const key = weekKey(currentWeekStart);
  const body = document.getElementById("scheduleBody");
  body.innerHTML = "";

  const consultores = getConsultoresFiltrados();

  if (consultores.length === 0) {
    body.innerHTML = `<tr><td colspan="2" class="empty-hint">${state.consultores.length === 0 ? "Cadastre consultores para comecar." : "Nenhum consultor encontrado com o filtro selecionado."}</td></tr>`;
    return;
  }

  consultores.forEach((consultor) => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = consultor;

    const tdAlloc = document.createElement("td");

    if (isConsultorDeFeriasNaSemana(consultor, currentWeekStart)) {
      const tag = document.createElement("span");
      tag.className = "alloc-tag ferias";
      tag.textContent = "FERIAS";
      tdAlloc.appendChild(tag);
      tr.appendChild(tdName);
      tr.appendChild(tdAlloc);
      body.appendChild(tr);
      return;
    }

    const weekAllocs = state.allocations[key] || {};
    const consultorAllocs = weekAllocs[consultor] || [];

    consultorAllocs.forEach((alloc, idx) => {
      const tag = document.createElement("span");
      tag.className = `alloc-tag ${alloc.modalidade}`;
      tag.innerHTML = `${escapeHtml(alloc.empresa)} &middot; ${alloc.modalidade === "presencial" ? "Presencial" : "Remoto"} `;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "x";
      removeBtn.onclick = () => removeAllocation(key, consultor, idx);
      tag.appendChild(removeBtn);
      tdAlloc.appendChild(tag);
    });

    renderAllocControl(tdAlloc, key, consultor, false);

    tr.appendChild(tdName);
    tr.appendChild(tdAlloc);
    body.appendChild(tr);
  });
}

function renderResumoSemana() {
  const key = weekKey(currentWeekStart);
  const weekAllocs = state.allocations[key] || {};

  let totalAlocacoes = 0;
  let presencial = 0;
  let remoto = 0;
  let emFerias = 0;
  const empresasNaSemana = new Set();

  getConsultoresFiltrados().forEach((consultor) => {
    if (isConsultorDeFeriasNaSemana(consultor, currentWeekStart)) {
      emFerias++;
      return;
    }
    (weekAllocs[consultor] || []).forEach((alloc) => {
      totalAlocacoes++;
      empresasNaSemana.add(alloc.empresa);
      if (alloc.modalidade === "presencial") presencial++;
      else remoto++;
    });
  });

  const cards = [
    { lbl: "Alocacoes na semana", val: totalAlocacoes },
    { lbl: "Empresas atendidas", val: empresasNaSemana.size },
    { lbl: "Presencial", val: presencial },
    { lbl: "Remoto", val: remoto },
    { lbl: "Consultores de ferias", val: emFerias },
  ];

  document.getElementById("sumCards").innerHTML = cards
    .map((c) => `<div class="sum-card"><div class="sum-lbl">${c.lbl}</div><div class="sum-val">${c.val}</div></div>`)
    .join("");
}

function renderPeriodo() {
  const head = document.getElementById("periodoHead");
  const body = document.getElementById("periodoBody");
  head.innerHTML = "";
  body.innerHTML = "";

  const numWeeks = Math.max(2, Math.min(26, parseInt(document.getElementById("periodoWeeks").value, 10) || 8));

  const weekStarts = [];
  for (let i = 0; i < numWeeks; i++) {
    const ws = new Date(currentWeekStart);
    ws.setDate(ws.getDate() + i * 7);
    weekStarts.push(ws);
  }

  const thName = document.createElement("th");
  thName.style.width = "180px";
  thName.textContent = "Consultor";
  head.appendChild(thName);

  weekStarts.forEach((ws) => {
    const th = document.createElement("th");
    th.className = "week-col";
    const end = new Date(ws);
    end.setDate(end.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    th.textContent = `${fmt(ws)} a ${fmt(end)}`;
    th.title = "Clique para abrir esta semana na visao Semanal";
    th.onclick = () => {
      currentWeekStart = getStartOfWeek(ws);
      setView("semana");
    };
    head.appendChild(th);
  });

  const consultores = getConsultoresFiltrados();

  if (consultores.length === 0) {
    body.innerHTML = `<tr><td colspan="${numWeeks + 1}" class="empty-hint">${state.consultores.length === 0 ? "Cadastre consultores para comecar." : "Nenhum consultor encontrado com o filtro selecionado."}</td></tr>`;
    return;
  }

  consultores.forEach((consultor) => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = consultor;
    tr.appendChild(tdName);

    weekStarts.forEach((ws, idx) => {
      const td = document.createElement("td");
      td.className = "periodo-cell";

      if (isConsultorDeFeriasNaSemana(consultor, ws)) {
        const tag = document.createElement("span");
        tag.className = "alloc-tag ferias";
        tag.textContent = "FERIAS";
        td.appendChild(tag);
        tr.appendChild(td);
        return;
      }

      const key = weekKey(ws);
      const allocs = (state.allocations[key] || {})[consultor] || [];

      allocs.forEach((alloc, allocIdx) => {
        const tag = document.createElement("span");
        tag.className = `alloc-tag ${alloc.modalidade}`;
        tag.innerHTML = `${escapeHtml(alloc.empresa)} (${alloc.modalidade === "presencial" ? "Pres." : "Rem."}) `;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "x";
        removeBtn.onclick = () => removeAllocation(key, consultor, allocIdx);
        tag.appendChild(removeBtn);
        td.appendChild(tag);
      });

      renderAllocControl(td, key, consultor, true);

      if (allocs.length > 0 && idx < weekStarts.length - 1) {
        const replicarBtn = document.createElement("button");
        replicarBtn.className = "periodo-replicar-btn";
        replicarBtn.textContent = "Replicar para as proximas →";
        replicarBtn.onclick = () => replicarAlocacaoConsultor(consultor, ws, weekStarts.slice(idx + 1));
        td.appendChild(replicarBtn);
      }

      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

function setView(mode) {
  viewMode = mode;
  document.getElementById("viewSemana").classList.toggle("active", mode === "semana");
  document.getElementById("viewPeriodo").classList.toggle("active", mode === "periodo");
  document.getElementById("semanaView").style.display = mode === "semana" ? "" : "none";
  document.getElementById("periodoView").style.display = mode === "periodo" ? "" : "none";
  render();
}

function renderCiclosBox(box, consultor) {
  box.innerHTML = "";

  if (!getVencimentoContrato(consultor)) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "Defina o vencimento do contrato na aba Cadastro para calcular o saldo de ferias.";
    box.appendChild(hint);
    return;
  }

  const fmt = (d) => d.toLocaleDateString("pt-BR");
  const ciclos = getCiclosConsultor(consultor);
  const table = document.createElement("table");
  table.className = "ciclos-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Periodo</th><th>Inicio</th><th>Fim</th><th>Dias usados</th><th>Saldo</th><th>Status</th><th>Alerta</th>
      </tr>
    </thead>
    <tbody>
      ${ciclos
        .map((c) => {
          const pct = Math.min(100, Math.round((c.usados / DIREITO_DIAS) * 100));
          const barColor = c.saldo <= 0 ? "var(--danger)" : c.saldo <= 5 ? "#92400e" : "var(--presencial)";
          return `
            <tr>
              <td>${c.num}${c.status === "atual" ? " &middot; atual" : ""}</td>
              <td>${fmt(c.inicio)}</td>
              <td>${fmt(c.fim)}</td>
              <td>${c.usados}</td>
              <td>
                <div class="saldo-bar-wrap">
                  <div class="saldo-bar-track"><div class="saldo-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
                  <span>${c.saldo}</span>
                </div>
              </td>
              <td><span class="status-chip ${c.status}">${c.status}</span></td>
              <td><span class="alert-pill ${c.alerta.nivel}">${c.alerta.texto}</span></td>
            </tr>
          `;
        })
        .join("")}
    </tbody>
  `;
  box.appendChild(table);
}

function getAlertaAtual(consultor) {
  const ciclos = getCiclosConsultor(consultor);
  return ciclos.find((c) => c.status === "atual") || null;
}

function renderFeriasResumo() {
  const container = document.getElementById("feriasSumCards");
  if (!container) return;

  let emFeriasHoje = 0;
  let semDataBase = 0;
  let saldoCritico = 0;
  let diasVencidos = 0;
  const ativos = getConsultoresAtivos();

  ativos.forEach((consultor) => {
    if (isConsultorDeFeriasHoje(consultor)) emFeriasHoje++;
    if (!getVencimentoContrato(consultor)) {
      semDataBase++;
      return;
    }
    getCiclosConsultor(consultor).forEach((c) => {
      if (c.status === "atual" && c.saldo <= 5) saldoCritico++;
      if (c.status === "passado" && c.saldo > 0) diasVencidos += c.saldo;
    });
  });

  const cards = [
    { lbl: "Consultores ativos", val: ativos.length },
    { lbl: "Em ferias hoje", val: emFeriasHoje, cls: emFeriasHoje > 0 ? "warn" : "ok" },
    { lbl: "Saldo critico (<=5 dias)", val: saldoCritico, cls: saldoCritico > 0 ? "danger" : "ok" },
    { lbl: "Dias vencidos (total)", val: diasVencidos, cls: diasVencidos > 0 ? "danger" : "ok" },
    { lbl: "Sem vencimento de contrato", val: semDataBase, cls: semDataBase > 0 ? "warn" : "ok" },
  ];

  container.innerHTML = cards
    .map((c) => `<div class="sum-card ${c.cls || ""}"><div class="sum-lbl">${c.lbl}</div><div class="sum-val">${c.val}</div></div>`)
    .join("");
}

function renderDashboard() {
  const cardsContainer = document.getElementById("dashboardCards");
  const alertasContainer = document.getElementById("dashboardAlertas");
  if (!cardsContainer || !alertasContainer) return;

  const hojeWeekStart = getStartOfWeek(new Date());
  const hojeKey = weekKey(hojeWeekStart);
  const hojeAllocs = state.allocations[hojeKey] || {};

  let totalAlocacoesSemana = 0;
  let emFeriasHoje = 0;
  const empresasSemana = new Set();
  const alertas = [];
  const ativos = getConsultoresAtivos();
  const inativos = state.consultores.length - ativos.length;

  ativos.forEach((consultor) => {
    if (isConsultorDeFeriasHoje(consultor)) emFeriasHoje++;
    if (!isConsultorDeFeriasNaSemana(consultor, hojeWeekStart)) {
      (hojeAllocs[consultor] || []).forEach((alloc) => {
        totalAlocacoesSemana++;
        empresasSemana.add(alloc.empresa);
      });
    }
    const alertaAtual = getAlertaAtual(consultor);
    if (alertaAtual && (alertaAtual.alerta.nivel === "danger" || alertaAtual.alerta.nivel === "warn")) {
      alertas.push({ consultor, texto: alertaAtual.alerta.texto, nivel: alertaAtual.alerta.nivel });
    }
  });

  const cards = [
    { lbl: "Consultores ativos", val: ativos.length },
    { lbl: "Consultores inativos", val: inativos, cls: inativos > 0 ? "warn" : "ok" },
    { lbl: "Empresas cadastradas", val: state.empresas.length },
    { lbl: "Em ferias hoje", val: emFeriasHoje, cls: emFeriasHoje > 0 ? "warn" : "ok" },
    { lbl: "Alocacoes (semana atual)", val: totalAlocacoesSemana },
    { lbl: "Empresas atendidas (semana atual)", val: empresasSemana.size },
    { lbl: "Alertas de ferias", val: alertas.length, cls: alertas.length > 0 ? "danger" : "ok" },
  ];

  cardsContainer.innerHTML = cards
    .map((c) => `<div class="sum-card ${c.cls || ""}"><div class="sum-lbl">${c.lbl}</div><div class="sum-val">${c.val}</div></div>`)
    .join("");

  if (alertas.length === 0) {
    alertasContainer.innerHTML = `<li class="empty-hint">Nenhum alerta de ferias no momento.</li>`;
  } else {
    alertasContainer.innerHTML = alertas
      .map((a) => `<li><span>${escapeHtml(a.consultor)}</span><span class="alert-pill ${a.nivel}">${escapeHtml(a.texto)}</span></li>`)
      .join("");
  }
}

function renderFerias() {
  const container = document.getElementById("feriasContainer");
  container.innerHTML = "";

  if (state.consultores.length === 0) {
    container.innerHTML = `<span class="empty-hint">Cadastre consultores na aba Cadastro para controlar ferias.</span>`;
    return;
  }

  state.consultores.forEach((consultor) => {
    const info = getFeriasConsultor(consultor);
    const status = getStatusConsultor(consultor);
    const card = document.createElement("div");
    card.className = "ferias-card";

    const title = document.createElement("h3");
    title.textContent = consultor;
    if (!status.ativo) {
      const badge = document.createElement("span");
      badge.className = "status-chip passado";
      badge.style.marginLeft = "8px";
      badge.textContent = status.dataRescisao
        ? `Inativo desde ${parseDate(status.dataRescisao).toLocaleDateString("pt-BR")}`
        : "Inativo";
      title.appendChild(badge);
    }
    card.appendChild(title);

    const vencimento = getVencimentoContrato(consultor);
    if (vencimento) {
      const baseRow = document.createElement("div");
      baseRow.className = "data-base-row";
      baseRow.innerHTML = `Vencimento do contrato: <strong>${parseDate(vencimento).toLocaleDateString("pt-BR")}</strong> (definido na aba Cadastro)`;
      card.appendChild(baseRow);
    }

    const ciclosBox = document.createElement("div");
    ciclosBox.dataset.ciclosFor = consultor;
    renderCiclosBox(ciclosBox, consultor);
    card.appendChild(ciclosBox);

    const periodoForm = document.createElement("div");
    periodoForm.className = "setup-row";
    const inicioInput = document.createElement("input");
    inicioInput.type = "date";
    const fimInput = document.createElement("input");
    fimInput.type = "date";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Registrar ferias";
    addBtn.onclick = () => {
      if (!inicioInput.value || !fimInput.value) return;
      addPeriodoFerias(consultor, inicioInput.value, fimInput.value);
    };
    periodoForm.appendChild(inicioInput);
    periodoForm.appendChild(fimInput);
    periodoForm.appendChild(addBtn);
    card.appendChild(periodoForm);

    const list = document.createElement("ul");
    list.className = "periodo-list";
    if (info.periodos.length === 0) {
      list.innerHTML = `<li class="empty-hint">Nenhum periodo de ferias registrado.</li>`;
    } else {
      info.periodos.forEach((p, idx) => {
        const li = document.createElement("li");
        const dias = diasEntre(parseDate(p.inicio), parseDate(p.fim));
        const span = document.createElement("span");
        span.textContent = `${parseDate(p.inicio).toLocaleDateString("pt-BR")} a ${parseDate(p.fim).toLocaleDateString("pt-BR")} (${dias} dias)`;
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remover";
        removeBtn.onclick = () => removePeriodoFerias(consultor, idx);
        li.appendChild(span);
        li.appendChild(removeBtn);
        list.appendChild(li);
      });
    }
    card.appendChild(list);

    container.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Mutations ---
function addConsultor(name) {
  const trimmed = name.trim();
  if (!trimmed || state.consultores.includes(trimmed)) return;
  state.consultores.push(trimmed);
  render();
}

function removeConsultor(name) {
  state.consultores = state.consultores.filter((c) => c !== name);
  Object.values(state.allocations).forEach((week) => delete week[name]);
  delete state.ferias[name];
  delete state.contratos[name];
  delete state.status[name];
  render();
}

function addEmpresa(name) {
  const trimmed = name.trim();
  if (!trimmed || state.empresas.includes(trimmed)) return;
  state.empresas.push(trimmed);
  render();
}

function removeEmpresa(name) {
  state.empresas = state.empresas.filter((e) => e !== name);
  Object.values(state.allocations).forEach((week) => {
    Object.keys(week).forEach((consultor) => {
      week[consultor] = week[consultor].filter((a) => a.empresa !== name);
    });
  });
  render();
}

function addAllocacoes(weekKeyStr, consultor, empresas, modalidade) {
  if (empresas.length === 0) return;
  if (!state.allocations[weekKeyStr]) state.allocations[weekKeyStr] = {};
  if (!state.allocations[weekKeyStr][consultor]) state.allocations[weekKeyStr][consultor] = [];
  empresas.forEach((empresa) => {
    state.allocations[weekKeyStr][consultor].push({ empresa, modalidade });
  });
  render();
}

function removeAllocation(weekKeyStr, consultor, idx) {
  state.allocations[weekKeyStr][consultor].splice(idx, 1);
  render();
}

function replicarAlocacaoConsultor(consultor, origemStart, destinosStart) {
  const origemKey = weekKey(origemStart);
  const allocs = (state.allocations[origemKey] || {})[consultor];
  if (!allocs || allocs.length === 0) return;

  destinosStart.forEach((destinoStart) => {
    if (isConsultorDeFeriasNaSemana(consultor, destinoStart)) return;
    const destinoKey = weekKey(destinoStart);
    if (!state.allocations[destinoKey]) state.allocations[destinoKey] = {};
    state.allocations[destinoKey][consultor] = allocs.map((a) => ({ ...a }));
  });
  render();
}

function replicarSemanaAtual(numSemanas) {
  const origemKey = weekKey(currentWeekStart);
  const origemAllocs = state.allocations[origemKey] || {};

  for (let i = 1; i <= numSemanas; i++) {
    const destinoStart = new Date(currentWeekStart);
    destinoStart.setDate(destinoStart.getDate() + i * 7);
    const destinoKey = weekKey(destinoStart);

    state.consultores.forEach((consultor) => {
      if (isConsultorDeFeriasNaSemana(consultor, destinoStart)) return;
      const allocs = origemAllocs[consultor];
      if (!allocs || allocs.length === 0) return;
      if (!state.allocations[destinoKey]) state.allocations[destinoKey] = {};
      state.allocations[destinoKey][consultor] = allocs.map((a) => ({ ...a }));
    });
  }
  render();
}

function addPeriodoFerias(consultor, inicio, fim) {
  if (parseDate(fim) < parseDate(inicio)) return;
  getFeriasConsultor(consultor).periodos.push({ inicio, fim });
  render();
}

function removePeriodoFerias(consultor, idx) {
  getFeriasConsultor(consultor).periodos.splice(idx, 1);
  render();
}

// --- Backup ---
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportBackupJson() {
  const dataStr = JSON.stringify(state, null, 2);
  downloadFile(`agenda-consultores-backup-${dateToStr(new Date())}.json`, dataStr, "application/json");
}

function importBackupJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.consultores || !data.empresas) throw new Error("Arquivo invalido");
      Object.assign(state, data);
      if (!state.ferias) state.ferias = {};
      if (!state.contratos) state.contratos = {};
      if (!state.status) state.status = {};
      render();
      alert("Backup importado com sucesso.");
    } catch (err) {
      alert("Erro ao importar: arquivo invalido.");
    }
  };
  reader.readAsText(file);
}

function exportAllocationsCsv() {
  const rows = [["Semana", "Consultor", "Empresa", "Modalidade"]];
  Object.keys(state.allocations)
    .sort()
    .forEach((week) => {
      Object.keys(state.allocations[week]).forEach((consultor) => {
        state.allocations[week][consultor].forEach((alloc) => {
          rows.push([week, consultor, alloc.empresa, alloc.modalidade]);
        });
      });
    });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile(`alocacoes-${dateToStr(new Date())}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
}

// --- Event wiring ---
document.getElementById("addConsultor").onclick = () => {
  const input = document.getElementById("newConsultor");
  addConsultor(input.value);
  input.value = "";
};

document.getElementById("addEmpresa").onclick = () => {
  const input = document.getElementById("newEmpresa");
  addEmpresa(input.value);
  input.value = "";
};

document.getElementById("newConsultor").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addConsultor").click();
});
document.getElementById("newEmpresa").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addEmpresa").click();
});

document.getElementById("prevWeek").onclick = () => {
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  render();
};
document.getElementById("nextWeek").onclick = () => {
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  render();
};
document.getElementById("todayWeek").onclick = () => {
  currentWeekStart = getStartOfWeek(new Date());
  render();
};

document.getElementById("replicarBtn").onclick = () => {
  const n = Math.max(1, Math.min(26, parseInt(document.getElementById("replicarWeeks").value, 10) || 1));
  replicarSemanaAtual(n);
};

document.getElementById("filtroConsultor").addEventListener("change", (e) => {
  filtroConsultorAtual = e.target.value;
  if (viewMode === "semana") {
    renderSchedule();
    renderResumoSemana();
  } else {
    renderPeriodo();
  }
});

document.getElementById("viewSemana").onclick = () => setView("semana");
document.getElementById("viewPeriodo").onclick = () => setView("periodo");
document.getElementById("periodoWeeks").addEventListener("change", () => {
  if (viewMode === "periodo") renderPeriodo();
});

document.getElementById("exportBackup").onclick = exportBackupJson;
document.getElementById("exportCsv").onclick = exportAllocationsCsv;
document.getElementById("importBackupBtn").onclick = () => {
  document.getElementById("importBackupFile").click();
};
document.getElementById("importBackupFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importBackupJson(file);
  e.target.value = "";
});

document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab-button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  };
});

render();
