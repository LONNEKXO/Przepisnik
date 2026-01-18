// app.js
(() => {
  // ===== Supabase sync config =====
  const API_BASE = "https://dnuebkauakifgkagiurz.supabase.co/functions/v1";
 const SUPABASE_LEGACY_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudWVia2F1YWtpZmdrYWdpdXJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3Mjk1ODIsImV4cCI6MjA4NDMwNTU4Mn0.hsJ87gKU9hmIuRE4gvG31IIskqTqYFGYylVO2YEpaGM";
  const STORAGE_KEY = "przepiśnik.v2";

  // ===== Session (RAM only) =====
  let SESSION_TOKEN = null;
  const getSession = () => SESSION_TOKEN;
  const setSession = (t) => { SESSION_TOKEN = t; };
  const clearSession = () => { SESSION_TOKEN = null; };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    children.forEach((c) => n.appendChild(c));
    return n;
  };

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + Date.now().toString(16)));

  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove("show"), 1700);
  };

  const syncTagEl = () => $("#syncTag");

  const lockUI = (locked) => {
    const app = document.querySelector(".app");
    if (!app) return;
    if (locked) app.classList.add("locked");
    else app.classList.remove("locked");

    const lockIds = ["addCategoryBtn", "addRecipeBtn", "exportBtn", "importBtn", "editRecipeBtn", "deleteRecipeBtn"];
    lockIds.forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = locked;
    });
  };

  async function apiFetch(path, { method = "GET", body = null, sessionToken = null } = {}) {
    const headers = {
      apikey: SUPABASE_LEGACY_ANON,
      Authorization: "Bearer " + SUPABASE_LEGACY_ANON,
    };
    if (body) headers["Content-Type"] = "application/json";
    if (sessionToken) headers["x-session-token"] = sessionToken;

    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
  }

  async function remoteLogin(username, password) {
    const res = await apiFetch("/login", { method: "POST", body: { username, password } });
    if (!res.ok) throw new Error("LOGIN_FAILED");
    const data = await res.json();
    if (!data?.token) throw new Error("LOGIN_NO_TOKEN");
    return data.token;
  }

async function remoteLoad() {
  const token = getSession();
  if (!token) throw new Error("NO_SESSION");

  const res = await apiFetch("/state", { method: "GET", sessionToken: token });
  if (!res.ok) throw new Error("REMOTE_GET_FAILED");

  const raw = await res.json();

  // obsługa różnych formatów: {data:{...}}, {ok:true,data:{...}}, albo {...}
  const data = (raw && raw.data) ? raw.data : raw;

  return data || {};
}



  async function remoteSave(data) {
    const token = getSession();
    if (!token) throw new Error("NO_SESSION");
    const res = await apiFetch("/state", { method: "POST", body: data, sessionToken: token });
    if (!res.ok) throw new Error("REMOTE_POST_FAILED");
    return res.json();
  }

  // ===== Local data =====
  const defaultData = () => ({
    categories: [
      { id: "all", name: "Wszystkie" },
      { id: "uncat", name: "Bez kategorii" },
      { id: uid(), name: "Ciasta" },
      { id: uid(), name: "Zupy" },
      { id: uid(), name: "Makarony" },
      { id: uid(), name: "Szybkie" },
    ],
    recipes: [
      {
        id: uid(),
        categoryId: "uncat",
        title: "Zupa pomidorowa (speedrun)",
        ingredients: [
          { name: "Passata pomidorowa", amount: "500", unit: "ml" },
          { name: "Bulion", amount: "700", unit: "ml" },
          { name: "Śmietanka 18%", amount: "80", unit: "ml" },
          { name: "Makaron", amount: "150", unit: "g" },
          { name: "Sól, pieprz, bazylia", amount: "", unit: "" },
        ],
        steps:
          "1) Podgrzej bulion + passatę.\n2) Dopraw.\n3) Dorzuć ugotowany makaron.\n4) Zdejmij z ognia, dodaj śmietankę i zamieszaj.\n5) Zjedz jak król/królowa kuchni.",
        createdAt: Date.now(),
      },
    ],
  });

  const loadLocal = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const saveLocal = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));

  // ===== State =====
  const state = {
    data: loadLocal() || defaultData(),
    selectedCategoryId: "all",
    selectedRecipeId: null,
    search: "",
    editingRecipeId: null,
    editingCategoryId: null,

    catDropdownOpen: false,
    catDropdownQuery: "",
    catDropdownValue: "uncat",

    _syncTimer: null,
  };

  // --- migracja / naprawa danych ---
  const ensureCoreCategories = () => {
    if (!state.data.categories.some((c) => c.id === "all")) {
      state.data.categories.unshift({ id: "all", name: "Wszystkie" });
    }
    if (!state.data.categories.some((c) => c.id === "uncat")) {
      state.data.categories.splice(1, 0, { id: "uncat", name: "Bez kategorii" });
    }
    const validIds = new Set(state.data.categories.map((c) => c.id));
    state.data.recipes.forEach((r) => {
      if (!r.categoryId || !validIds.has(r.categoryId) || r.categoryId === "all") r.categoryId = "uncat";
    });
  };

  ensureCoreCategories();
  saveLocal();

  const getCategoryName = (id) => {
    if (!id) return "Bez kategorii";
    const c = state.data.categories.find((x) => x.id === id);
    return c ? c.name : "Bez kategorii";
  };

  const recipeCountInCategory = (catId) => {
    if (catId === "all") return state.data.recipes.length;
    return state.data.recipes.filter((r) => r.categoryId === catId).length;
  };

  const filteredRecipes = () => {
    const q = state.search.trim().toLowerCase();
    return state.data.recipes
      .filter((r) => (state.selectedCategoryId === "all" ? true : r.categoryId === state.selectedCategoryId))
      .filter((r) => {
        if (!q) return true;
        const hay = [r.title, r.steps, ...(r.ingredients || []).map((i) => `${i.name} ${i.amount} ${i.unit}`)]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  };

const normalizeData = (d) => {
  const data = d && typeof d === "object" ? d : {};
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    recipes: Array.isArray(data.recipes) ? data.recipes : [],
  };
};

const mergeById = (baseArr, addArr) => {
  const out = [];
  const seen = new Set();

  for (const x of baseArr) {
    if (!x || !x.id) continue;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  for (const x of addArr) {
    if (!x || !x.id) continue;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
};

const mergeState = (remoteRaw, localRaw) => {
  const remote = normalizeData(remoteRaw);
  const local = normalizeData(localRaw);

  return {
    categories: mergeById(remote.categories, local.categories),
    recipes: mergeById(remote.recipes, local.recipes),
  };
};

const persist = () => {
  saveLocal();

  const token = getSession();
  if (!token) {
    syncTagEl().textContent = "offline";
    return;
  }

  syncTagEl().textContent = "sync...";
  clearTimeout(state._syncTimer);

  state._syncTimer = setTimeout(async () => {
    try {
      const remote = await remoteLoad();
      const merged = mergeState(remote, state.data);

      state.data = merged;
      ensureCoreCategories();
      saveLocal();

      await remoteSave(state.data);

      syncTagEl().textContent = "synced";
    } catch (e) {
      syncTagEl().textContent = "offline";
      console.error(e);
    }
  }, 500);
};



  // ---------- Custom dropdown ----------
  const setCatDropdownValue = (id) => {
    state.catDropdownValue = id;
    $("#recipeCategoryHidden").value = id;
    $("#catSelectLabel").textContent = getCategoryName(id);
    renderCatDropdownOptions();
  };

  const openCatDropdown = () => {
    state.catDropdownOpen = true;
    $("#catSelectMenu").classList.add("open");
    $("#catSelectBtn").setAttribute("aria-expanded", "true");
    $("#catSelectSearch").value = state.catDropdownQuery;
    setTimeout(() => $("#catSelectSearch").focus(), 0);
    renderCatDropdownOptions();
  };

  const closeCatDropdown = () => {
    state.catDropdownOpen = false;
    $("#catSelectMenu").classList.remove("open");
    $("#catSelectBtn").setAttribute("aria-expanded", "false");
    state.catDropdownQuery = "";
    $("#catSelectSearch").value = "";
  };

  const renderCatDropdownOptions = () => {
    const wrap = $("#catSelectOptions");
    if (!wrap) return;
    wrap.innerHTML = "";

    const q = (state.catDropdownQuery || "").trim().toLowerCase();
    const cats = state.data.categories
      .filter((c) => c.id !== "all")
      .filter((c) => (!q ? true : c.name.toLowerCase().includes(q)));

    if (!cats.length) {
      wrap.appendChild(el("div", { class: "cselect-opt", html: `<div class="name">Brak wyników</div><div class="sub">: (</div>` }));
      return;
    }

    cats.forEach((c) => {
      const count = recipeCountInCategory(c.id);
      const node = el(
        "div",
        {
          class: "cselect-opt" + (c.id === state.catDropdownValue ? " active" : ""),
          onclick: () => {
            setCatDropdownValue(c.id);
            closeCatDropdown();
          },
        },
        [el("div", { class: "name", text: c.name }), el("div", { class: "sub", text: String(count) })]
      );
      wrap.appendChild(node);
    });
  };

  // ---------- RENDER ----------
  const renderHeader = () => {
    const name = state.selectedCategoryId === "all" ? "🍲 Wszystkie przepisy" : `📁 ${getCategoryName(state.selectedCategoryId)}`;
    $("#headerTitle").textContent = name;
  };

  const renderCategories = () => {
    const wrap = $("#categoryList");
    wrap.innerHTML = "";

    state.data.categories.forEach((cat) => {
      const count = recipeCountInCategory(cat.id);
      const canEdit = cat.id !== "all" && cat.id !== "uncat";
      const canDelete = cat.id !== "all" && cat.id !== "uncat";

      const item = el(
        "div",
        {
          class: "cat" + (cat.id === state.selectedCategoryId ? " active" : ""),
          onclick: () => {
            state.selectedCategoryId = cat.id;
            state.selectedRecipeId = null;
            renderAll();
          },
        },
        [
          el("div", { class: "left" }, [el("div", { class: "folder", text: "📁" }), el("div", { class: "name", text: cat.name })]),
          el("div", { class: "row" }, [
            el("div", { class: "pill", text: String(count) }),
            canEdit
              ? el("button", { class: "icon-btn", title: "Edytuj kategorię", onclick: (e) => (e.stopPropagation(), openCategoryModal(cat.id)) }, [
                  document.createTextNode("✎"),
                ])
              : el("div", { style: "width:40px" }),
            canDelete
              ? el("button", { class: "icon-btn danger", title: "Usuń kategorię", onclick: (e) => (e.stopPropagation(), deleteCategory(cat.id)) }, [
                  document.createTextNode("🗑"),
                ])
              : el("div", { style: "width:40px" }),
          ]),
        ]
      );

      wrap.appendChild(item);
    });
  };

  const renderRecipeList = () => {
    const wrap = $("#recipeList");
    wrap.innerHTML = "";
    const items = filteredRecipes();
    $("#countPill").textContent = String(items.length);

    if (!items.length) {
      wrap.appendChild(el("div", { class: "empty", text: "Brak przepisów w tej kategorii. Dodaj coś pysznego. 🍽️" }));
      return;
    }

    items.forEach((r) => {
      const metaBits = [`Składniki: ${(r.ingredients || []).length}`, `Kategoria: ${getCategoryName(r.categoryId)}`];
      const node = el(
        "div",
        {
          class: "recipe-item" + (r.id === state.selectedRecipeId ? " active" : ""),
          onclick: () => {
            state.selectedRecipeId = r.id;
            renderAll();
          },
        },
        [el("div", { class: "title", text: r.title }), el("div", { class: "meta" }, metaBits.map((t) => el("span", { text: t })))]
      );
      wrap.appendChild(node);
    });
  };

  const renderRecipeDetail = () => {
    const wrap = $("#recipeDetail");
    const r = state.data.recipes.find((x) => x.id === state.selectedRecipeId);
    const editBtn = $("#editRecipeBtn");
    const delBtn = $("#deleteRecipeBtn");

    if (!r) {
      editBtn.disabled = true;
      delBtn.disabled = true;
      wrap.innerHTML = `<div class="empty">Kliknij przepis z listy po lewej — pokażę składniki i instrukcję.</div>`;
      return;
    }

    editBtn.disabled = !getSession();
    delBtn.disabled = !getSession();

    wrap.innerHTML = "";
    wrap.appendChild(el("h3", { class: "detail-title", text: r.title }));
    wrap.appendChild(
      el("div", { class: "detail-sub" }, [
        el("span", { class: "pill", text: `📁 ${getCategoryName(r.categoryId)}` }),
        el("span", { class: "pill", text: `🥕 ${(r.ingredients || []).length} składników` }),
      ])
    );

    wrap.appendChild(el("div", { style: "font-weight:900; margin-top:6px", text: "Składniki" }));
    const ul = el("ul");
    (r.ingredients || []).forEach((i) => {
      const amt = [i.amount, i.unit].filter(Boolean).join(" ").trim();
      const line = amt ? `${i.name} — ${amt}` : i.name;
      ul.appendChild(el("li", { text: line }));
    });
    wrap.appendChild(ul);

    wrap.appendChild(el("div", { class: "hr" }));
    wrap.appendChild(el("div", { style: "font-weight:900", text: "Sposób przygotowania" }));
    wrap.appendChild(el("div", { class: "small", style: "white-space:pre-wrap; margin-top:8px", text: r.steps || "Brak opisu." }));

    wrap.appendChild(
      el("div", { class: "footer-actions" }, [
        el("button", { class: "btn ghost", onclick: () => copyRecipe(r) }, [document.createTextNode("Kopiuj do schowka")]),
        el("button", { class: "btn", onclick: () => printRecipe(r) }, [document.createTextNode("Drukuj 🖨️")]),
      ])
    );
  };

  const renderAll = () => {
    renderHeader();
    renderCategories();
    renderRecipeList();
    renderRecipeDetail();
  };

  // ---------- COPY / PRINT ----------
  const copyRecipe = async (r) => {
    const lines = [];
    lines.push(r.title);
    lines.push(`Kategoria: ${getCategoryName(r.categoryId)}`);
    lines.push("");
    lines.push("Składniki:");
    (r.ingredients || []).forEach((i) => {
      const amt = [i.amount, i.unit].filter(Boolean).join(" ").trim();
      lines.push(`- ${amt ? amt + " " : ""}${i.name}`);
    });
    lines.push("");
    lines.push("Sposób przygotowania:");
    lines.push(r.steps || "");
    const txt = lines.join("\n");
    try {
      await navigator.clipboard.writeText(txt);
      toast("Skopiowane ✅");
    } catch {
      toast("Nie mogę skopiować (blokada przeglądarki).");
    }
  };

  const escapeHTML = (s) =>
    String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const printRecipe = (r) => {
    const area = $("#printArea");
    const ing = (r.ingredients || [])
      .map((i) => {
        const amt = [i.amount, i.unit].filter(Boolean).join(" ").trim();
        const line = amt ? `${escapeHTML(i.name)} — ${escapeHTML(amt)}` : `${escapeHTML(i.name)}`;
        return `<li>${line}</li>`;
      })
      .join("");

    area.innerHTML = `
      <h1>${escapeHTML(r.title)}</h1>
      <div class="meta">
        Kategoria: ${escapeHTML(getCategoryName(r.categoryId))} • Składniki: ${(r.ingredients || []).length}
      </div>
      <h2>Składniki</h2>
      <ul>${ing}</ul>
      <h2>Sposób przygotowania</h2>
      <pre>${escapeHTML(r.steps || "")}</pre>
    `;
    window.print();
  };

  // ---------- CATEGORY MODAL ----------
  const openCategoryModal = (categoryId = null) => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    state.editingCategoryId = categoryId;
    const isEdit = !!categoryId;
    $("#categoryModalTitle").textContent = isEdit ? "Edytuj kategorię" : "Dodaj kategorię";
    $("#categoryNameInput").value = isEdit ? state.data.categories.find((c) => c.id === categoryId)?.name || "" : "";
    $("#categoryModal").classList.add("open");
    $("#categoryNameInput").focus();
  };

  const closeCategoryModal = () => {
    $("#categoryModal").classList.remove("open");
    state.editingCategoryId = null;
  };

  const saveCategoryFromModal = () => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    const name = $("#categoryNameInput").value.trim();
    if (!name) return toast("Daj nazwę kategorii 🙂");

    if (state.editingCategoryId) {
      const cat = state.data.categories.find((c) => c.id === state.editingCategoryId);
      if (cat) cat.name = name;
      toast("Kategoria zaktualizowana ✨");
    } else {
      state.data.categories.push({ id: uid(), name });
      toast("Dodano kategorię 📁");
    }
    ensureCoreCategories();
    persist();
    closeCategoryModal();
    renderAll();
    renderCatDropdownOptions();
  };

  const deleteCategory = (categoryId) => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    const cat = state.data.categories.find((c) => c.id === categoryId);
    if (!cat) return;

    const count = recipeCountInCategory(categoryId);
    const ok = confirm(`Usunąć kategorię "${cat.name}"?\n\nPrzepisy w tej kategorii (${count}) trafią do "Bez kategorii".`);
    if (!ok) return;

    state.data.recipes.forEach((r) => {
      if (r.categoryId === categoryId) r.categoryId = "uncat";
    });

    state.data.categories = state.data.categories.filter((c) => c.id !== categoryId);
    if (state.selectedCategoryId === categoryId) state.selectedCategoryId = "all";

    ensureCoreCategories();
    persist();
    toast("Kategoria usunięta 🗑️ (przepisy uratowane)");
    renderAll();
    renderCatDropdownOptions();
  };

  // ---------- RECIPE MODAL ----------
  const ingredientRow = (ing = { name: "", amount: "", unit: "" }) => {
    const name = el("input", { class: "input", placeholder: "np. Mąka pszenna", value: ing.name });
    const amount = el("input", { class: "input", placeholder: "np. 200", value: ing.amount });
    const unit = el("input", { class: "input", placeholder: "g / ml / szt", value: ing.unit });
    const del = el("button", { class: "icon-btn danger", title: "Usuń składnik", onclick: () => row.remove() }, [document.createTextNode("🗑")]);
    const row = el("div", { class: "ing-row" }, [name, amount, unit, del]);
    row.getValue = () => ({ name: name.value.trim(), amount: amount.value.trim(), unit: unit.value.trim() });
    return row;
  };

  const openRecipeModal = (recipeId = null) => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    state.editingRecipeId = recipeId;

    const isEdit = !!recipeId;
    $("#recipeModalTitle").textContent = isEdit ? "Edytuj przepis" : "Dodaj przepis";

    const wrap = $("#ingredientsWrap");
    wrap.innerHTML = "";

    const defaultCat = state.selectedCategoryId !== "all" ? state.selectedCategoryId : "uncat";

    if (isEdit) {
      const r = state.data.recipes.find((x) => x.id === recipeId);
      $("#recipeTitleInput").value = r?.title || "";
      $("#recipeStepsInput").value = r?.steps || "";
      (r?.ingredients || []).forEach((i) => wrap.appendChild(ingredientRow(i)));
      if (!(r?.ingredients || []).length) wrap.appendChild(ingredientRow());
      setCatDropdownValue(r?.categoryId || "uncat");
    } else {
      $("#recipeTitleInput").value = "";
      $("#recipeStepsInput").value = "";
      wrap.appendChild(ingredientRow());
      wrap.appendChild(ingredientRow());
      setCatDropdownValue(defaultCat);
    }

    $("#recipeModal").classList.add("open");
    $("#recipeTitleInput").focus();
  };

  const closeRecipeModal = () => {
    $("#recipeModal").classList.remove("open");
    state.editingRecipeId = null;
    closeCatDropdown();
  };

  const collectIngredientsFromModal = () => {
    const wrap = $("#ingredientsWrap");
    const rows = [...wrap.querySelectorAll(".ing-row")];
    return rows.map((r) => r.getValue()).filter((i) => i.name);
  };

  const saveRecipeFromModal = () => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    const title = $("#recipeTitleInput").value.trim();
    const categoryId = $("#recipeCategoryHidden").value || "uncat";
    const steps = $("#recipeStepsInput").value.trim();
    const ingredients = collectIngredientsFromModal();

    if (!title) return toast("Nazwa dania jest obowiązkowa 🙂");
    if (!ingredients.length) return toast("Dodaj chociaż 1 składnik.");

    if (state.editingRecipeId) {
      const r = state.data.recipes.find((x) => x.id === state.editingRecipeId);
      if (r) {
        r.title = title;
        r.categoryId = categoryId;
        r.steps = steps;
        r.ingredients = ingredients;
      }
      toast("Przepis zaktualizowany ✨");
    } else {
      const r = { id: uid(), title, categoryId, steps, ingredients, createdAt: Date.now() };
      state.data.recipes.push(r);
      toast("Dodano przepis ✅");
      state.selectedRecipeId = r.id;
    }

    ensureCoreCategories();
    persist();
    closeRecipeModal();
    renderAll();
  };

  const deleteSelectedRecipe = () => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    const r = state.data.recipes.find((x) => x.id === state.selectedRecipeId);
    if (!r) return;
    const ok = confirm(`Usunąć przepis: "${r.title}"?`);
    if (!ok) return;
    state.data.recipes = state.data.recipes.filter((x) => x.id !== r.id);
    state.selectedRecipeId = null;
    ensureCoreCategories();
    persist();
    toast("Usunięto 🗑");
    renderAll();
  };

  // ---------- EXPORT / IMPORT ----------
  const exportJSON = () => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    const data = JSON.stringify(state.data, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "przepisy-backup.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Wyeksportowane 📦");
  };

  const importJSON = async (file) => {
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.recipes)) {
        return toast("Zły format pliku 😵‍💫");
      }
      state.data = parsed;
      ensureCoreCategories();
      state.selectedCategoryId = "all";
      state.selectedRecipeId = null;
      persist();
      toast("Zaimportowano ✅");
      renderAll();
      renderCatDropdownOptions();
    } catch {
      toast("Import się wywalił (zły JSON).");
    }
  };

  // ===== Auth overlay =====
  const openAuth = () => $("#authModal").classList.add("open");
  const closeAuth = () => $("#authModal").classList.remove("open");
  const setAuthError = (msg) => {
    const e = $("#authError");
    if (!msg) {
      e.classList.remove("show");
      e.textContent = "";
      return;
    }
    e.textContent = msg;
    e.classList.add("show");
  };

async function afterLoginSync() {
  try {
    syncTagEl().textContent = "sync...";

    const remote = await remoteLoad();
    const remoteLooksValid = remote && Array.isArray(remote.categories) && Array.isArray(remote.recipes);

    if (remoteLooksValid) {
      // ✅ chmura jest master
      state.data = remote;
      ensureCoreCategories();
      saveLocal();
      syncTagEl().textContent = "synced";
      toast("Wczytano wspólne dane ✅");
    } else {
      // ✅ jeśli chmura jest pusta/zepsuta – inicjalizujemy ją naszą lokalną
      ensureCoreCategories();
      await remoteSave(state.data);
      syncTagEl().textContent = "synced";
      toast("Ustawiono wspólne dane ✅");
    }
  } catch {
    syncTagEl().textContent = "offline";
    toast("Nie mogę zsynchronizować (offline).");
  }

  renderAll();
  renderCatDropdownOptions();
}


  // ---------- EVENTS ----------
  $("#addCategoryBtn").addEventListener("click", () => openCategoryModal());
  $("#closeCategoryModal").addEventListener("click", closeCategoryModal);
  $("#cancelCategoryBtn").addEventListener("click", closeCategoryModal);
  $("#saveCategoryBtn").addEventListener("click", saveCategoryFromModal);

  $("#addRecipeBtn").addEventListener("click", () => openRecipeModal());
  $("#closeRecipeModal").addEventListener("click", closeRecipeModal);
  $("#cancelRecipeBtn").addEventListener("click", closeRecipeModal);
  $("#saveRecipeBtn").addEventListener("click", saveRecipeFromModal);

  $("#addIngredientBtn").addEventListener("click", () => $("#ingredientsWrap").appendChild(ingredientRow()));
  $("#editRecipeBtn").addEventListener("click", () => state.selectedRecipeId && openRecipeModal(state.selectedRecipeId));
  $("#deleteRecipeBtn").addEventListener("click", deleteSelectedRecipe);

  $("#searchInput").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderRecipeList();
    renderRecipeDetail();
  });

  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = "";
  });

  $("#categoryModal").addEventListener("click", (e) => e.target.id === "categoryModal" && closeCategoryModal());
  $("#recipeModal").addEventListener("click", (e) => e.target.id === "recipeModal" && closeRecipeModal());

  $("#catSelectBtn").addEventListener("click", () => (state.catDropdownOpen ? closeCatDropdown() : openCatDropdown()));
  $("#catSelectBtn").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      state.catDropdownOpen ? closeCatDropdown() : openCatDropdown();
    }
  });
  $("#catSelectSearch").addEventListener("input", (e) => {
    state.catDropdownQuery = e.target.value;
    renderCatDropdownOptions();
  });
  document.addEventListener("click", (e) => {
    const wrap = $("#catSelectWrap");
    if (wrap && state.catDropdownOpen && !wrap.contains(e.target)) closeCatDropdown();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCategoryModal();
      closeRecipeModal();
      // nie zamykamy auth Escape gdy jest wymagana, ale i tak harmless:
      closeAuth();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#searchInput").focus();
    }
  });

  // auth buttons
  $("#openAuthBtn").addEventListener("click", openAuth);
  $("#authCloseBtn").addEventListener("click", () => {
    // nie pozwól zamknąć jeśli nie jesteś zalogowany
    if (!getSession()) return toast("Najpierw zaloguj się 🔐");
    closeAuth();
  });
  $("#authModal").addEventListener("click", (e) => {
    // klik w tło: nie zamykamy jeśli brak sesji
    if (e.target.id === "authModal") {
      if (!getSession()) return toast("Najpierw zaloguj się 🔐");
      closeAuth();
    }
  });

  $("#authLogoutBtn").addEventListener("click", () => {
    clearSession();
    syncTagEl().textContent = "offline";
    setAuthError(null);
    lockUI(true);
    openAuth();
    toast("Wylogowano ✅");
  });

  $("#authLoginBtn").addEventListener("click", async () => {
    setAuthError(null);
    const u = $("#authUser").value.trim();
    const p = $("#authPass").value;
    if (!u || !p) return setAuthError("Daj login i hasło 😉");

    try {
      syncTagEl().textContent = "login...";
      const token = await remoteLogin(u, p);
      setSession(token);
      closeAuth();
      lockUI(false);
      await afterLoginSync();
    } catch {
      syncTagEl().textContent = "offline";
      setAuthError("Nieprawidłowy login/hasło albo backend śpi.");
    }
  });

  // ===== Init =====
  const boot = async () => {
    renderAll();
    renderCatDropdownOptions();

    // zawsze wymuszamy logowanie od nowa:
    clearSession();
    syncTagEl().textContent = "offline";
    lockUI(true);
    openAuth();
  };

  boot();
})();




