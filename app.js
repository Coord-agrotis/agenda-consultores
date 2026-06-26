const STORAGE_KEY = "agenda-consultores-data";

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { consultores: [], empresas: [], allocations: {}, ferias: {} };
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
  return data;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadData();

// --- Week handling (ISO week, key = "YYYY-WW") ---
let currentWeekStart = getStartOfWeek(new Date());
let viewMode = "semana";

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

function getCicloAtual(dataBaseStr, refDate) {
  const base = parseDate(dataBaseStr);
  let n = refDate.getFullYear() - base.getFullYear();
  let cicloInicio = addYears(base, n);
  if (cicloInicio > refDate) {
    n -= 1;
    cicloInicio = addYears(base, n);
  }
  let cicloFim = new Date(addYears(base, n + 1) - MS_DAY);
  while (cicloFim < refDate) {
    n += 1;
    cicloInicio = addYears(base, n);
    cicloFim = new Date(addYears(base, n + 1) - MS_DAY);
  }
  return { inicio: cicloInicio, fim: cicloFim };
}

function getFeriasConsultor(consultor) {
  if (!state.ferias[consultor]) state.ferias[consultor] = { dataBase: null, periodos: [] };
  return state.ferias[consultor];
}

function calcularSaldo(consultor, refDate) {
  const info = getFeriasConsultor(consultor);
  if (!info.dataBase) return null;
  const ciclo = getCicloAtual(info.dataBase, refDate);
  let usados = 0;
  info.periodos.forEach((p) => {
    const pIni = parseDate(p.inicio);
    const pFim = parseDate(p.fim);
    const overlapIni = pIni > ciclo.inicio ? pIni : ciclo.inicio;
    const overlapFim = pFim < ciclo.fim ? pFim : ciclo.fim;
    if (overlapFim >= overlapIni) usados += diasEntre(overlapIni, overlapFim);
  });
  return { ciclo, usados, saldo: DIREITO_DIAS - usados };
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

// --- Rendering ---
function render() {
  document.getElementById("weekLabel").textContent = formatWeekLabel(currentWeekStart);
  renderChipList("consultorList", state.consultores, removeConsultor);
  renderChipList("empresaList", state.empresas, removeEmpresa);
  if (viewMode === "semana") {
    renderSchedule();
  } else {
    renderPeriodo();
  }
  renderFerias();
  saveData();
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

function renderSchedule() {
  const key = weekKey(currentWeekStart);
  const body = document.getElementById("scheduleBody");
  body.innerHTML = "";

  if (state.consultores.length === 0) {
    body.innerHTML = `<tr><td colspan="2" class="empty-hint">Cadastre consultores para comecar.</td></tr>`;
    return;
  }

  state.consultores.forEach((consultor) => {
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

    if (state.empresas.length > 0) {
      const form = document.createElement("div");
      form.className = "add-alloc-form";

      const empresaSelect = document.createElement("select");
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
      addBtn.textContent = "Alocar";
      addBtn.onclick = () => addAllocation(key, consultor, empresaSelect.value, modalidadeSelect.value);

      form.appendChild(empresaSelect);
      form.appendChild(modalidadeSelect);
      form.appendChild(addBtn);
      tdAlloc.appendChild(form);
    } else {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Cadastre empresas para alocar.";
      tdAlloc.appendChild(hint);
    }

    tr.appendChild(tdName);
    tr.appendChild(tdAlloc);
    body.appendChild(tr);
  });
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

  if (state.consultores.length === 0) {
    body.innerHTML = `<tr><td colspan="${numWeeks + 1}" class="empty-hint">Cadastre consultores para comecar.</td></tr>`;
    return;
  }

  state.consultores.forEach((consultor) => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = consultor;
    tr.appendChild(tdName);

    weekStarts.forEach((ws) => {
      const td = document.createElement("td");
      if (isConsultorDeFeriasNaSemana(consultor, ws)) {
        const tag = document.createElement("span");
        tag.className = "alloc-tag ferias";
        tag.textContent = "FERIAS";
        td.appendChild(tag);
      } else {
        const key = weekKey(ws);
        const allocs = (state.allocations[key] || {})[consultor] || [];
        if (allocs.length === 0) {
          td.innerHTML = `<span class="empty-hint">-</span>`;
        } else {
          allocs.forEach((alloc) => {
            const tag = document.createElement("span");
            tag.className = `alloc-tag ${alloc.modalidade}`;
            tag.textContent = `${alloc.empresa} (${alloc.modalidade === "presencial" ? "Presencial" : "Remoto"})`;
            td.appendChild(tag);
          });
        }
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

function renderFerias() {
  const container = document.getElementById("feriasContainer");
  container.innerHTML = "";

  if (state.consultores.length === 0) {
    container.innerHTML = `<span class="empty-hint">Cadastre consultores na aba Cadastro para controlar ferias.</span>`;
    return;
  }

  state.consultores.forEach((consultor) => {
    const info = getFeriasConsultor(consultor);
    const card = document.createElement("div");
    card.className = "ferias-card";

    const title = document.createElement("h3");
    title.textContent = consultor;
    card.appendChild(title);

    const baseRow = document.createElement("div");
    baseRow.className = "data-base-row";
    const baseLabel = document.createElement("span");
    baseLabel.textContent = "Data base:";
    const baseInput = document.createElement("input");
    baseInput.type = "date";
    if (info.dataBase) baseInput.value = info.dataBase;
    baseInput.onchange = () => setDataBase(consultor, baseInput.value);
    baseRow.appendChild(baseLabel);
    baseRow.appendChild(baseInput);
    card.appendChild(baseRow);

    if (info.dataBase) {
      const saldoInfo = calcularSaldo(consultor, new Date());
      const saldoBox = document.createElement("div");
      saldoBox.className = "saldo-box";
      const fmt = (d) => d.toLocaleDateString("pt-BR");
      saldoBox.innerHTML = `
        <span class="pill">Periodo atual: ${fmt(saldoInfo.ciclo.inicio)} a ${fmt(saldoInfo.ciclo.fim)}</span>
        <span class="pill">Dias utilizados: ${saldoInfo.usados}</span>
        <span class="pill ${saldoInfo.saldo <= 0 ? "alert" : ""}">Saldo: ${saldoInfo.saldo} dias</span>
      `;
      card.appendChild(saldoBox);
    } else {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Defina a data base para calcular o saldo de ferias.";
      card.appendChild(hint);
    }

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

function addAllocation(weekKeyStr, consultor, empresa, modalidade) {
  if (!state.allocations[weekKeyStr]) state.allocations[weekKeyStr] = {};
  if (!state.allocations[weekKeyStr][consultor]) state.allocations[weekKeyStr][consultor] = [];
  state.allocations[weekKeyStr][consultor].push({ empresa, modalidade });
  render();
}

function removeAllocation(weekKeyStr, consultor, idx) {
  state.allocations[weekKeyStr][consultor].splice(idx, 1);
  render();
}

function setDataBase(consultor, dataBase) {
  getFeriasConsultor(consultor).dataBase = dataBase;
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

document.getElementById("viewSemana").onclick = () => setView("semana");
document.getElementById("viewPeriodo").onclick = () => setView("periodo");
document.getElementById("periodoWeeks").addEventListener("change", () => {
  if (viewMode === "periodo") renderPeriodo();
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
