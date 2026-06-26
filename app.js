const STORAGE_KEY = "agenda-consultores-data";

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  return { consultores: [], clientes: [], allocations: {} };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadData();

// --- Week handling (ISO week, key = "YYYY-WW") ---
let currentWeekStart = getStartOfWeek(new Date());

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

// --- Rendering ---
function render() {
  document.getElementById("weekLabel").textContent = formatWeekLabel(currentWeekStart);
  renderChipList("consultorList", state.consultores, removeConsultor);
  renderChipList("clienteList", state.clientes, removeCliente);
  renderSchedule();
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

    const weekAllocs = state.allocations[key] || {};
    const consultorAllocs = weekAllocs[consultor] || [];

    consultorAllocs.forEach((alloc, idx) => {
      const tag = document.createElement("span");
      tag.className = `alloc-tag ${alloc.modalidade}`;
      tag.innerHTML = `${escapeHtml(alloc.cliente)} &middot; ${alloc.modalidade === "presencial" ? "Presencial" : "Remoto"} `;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "x";
      removeBtn.onclick = () => removeAllocation(key, consultor, idx);
      tag.appendChild(removeBtn);
      tdAlloc.appendChild(tag);
    });

    if (state.clientes.length > 0) {
      const form = document.createElement("div");
      form.className = "add-alloc-form";

      const clienteSelect = document.createElement("select");
      state.clientes.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        clienteSelect.appendChild(opt);
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
      addBtn.onclick = () => addAllocation(key, consultor, clienteSelect.value, modalidadeSelect.value);

      form.appendChild(clienteSelect);
      form.appendChild(modalidadeSelect);
      form.appendChild(addBtn);
      tdAlloc.appendChild(form);
    } else {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Cadastre clientes para alocar.";
      tdAlloc.appendChild(hint);
    }

    tr.appendChild(tdName);
    tr.appendChild(tdAlloc);
    body.appendChild(tr);
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
  render();
}

function addCliente(name) {
  const trimmed = name.trim();
  if (!trimmed || state.clientes.includes(trimmed)) return;
  state.clientes.push(trimmed);
  render();
}

function removeCliente(name) {
  state.clientes = state.clientes.filter((c) => c !== name);
  Object.values(state.allocations).forEach((week) => {
    Object.keys(week).forEach((consultor) => {
      week[consultor] = week[consultor].filter((a) => a.cliente !== name);
    });
  });
  render();
}

function addAllocation(weekKeyStr, consultor, cliente, modalidade) {
  if (!state.allocations[weekKeyStr]) state.allocations[weekKeyStr] = {};
  if (!state.allocations[weekKeyStr][consultor]) state.allocations[weekKeyStr][consultor] = [];
  state.allocations[weekKeyStr][consultor].push({ cliente, modalidade });
  render();
}

function removeAllocation(weekKeyStr, consultor, idx) {
  state.allocations[weekKeyStr][consultor].splice(idx, 1);
  render();
}

// --- Event wiring ---
document.getElementById("addConsultor").onclick = () => {
  const input = document.getElementById("newConsultor");
  addConsultor(input.value);
  input.value = "";
};

document.getElementById("addCliente").onclick = () => {
  const input = document.getElementById("newCliente");
  addCliente(input.value);
  input.value = "";
};

document.getElementById("newConsultor").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addConsultor").click();
});
document.getElementById("newCliente").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addCliente").click();
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

render();
