const state = {
  meals: [],
  sides: [],
  editingKind: "meal",
  savingFood: false,
  sideSearch: "",
  activeList: null,
  history: [],
  editingMealId: null,
  search: ""
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#mealForm"),
  foodDialog: $("#foodDialog"),
  foodFormError: $("#foodFormError"),
  mealId: $("#mealId"),
  mealName: $("#mealName"),
  mealIngredients: $("#mealIngredients"),
  mealCalories: $("#mealCalories"),
  mealServings: $("#mealServings"),
  mealServingSize: $("#mealServingSize"),
  caloriePreview: $("#caloriePreview"),
  formTitle: $("#formTitle"),
  cancelEditBtn: $("#cancelEditBtn"),
  csvInput: $("#csvInput"),
  mealSearch: $("#mealSearch"),
  mealLibrary: $("#mealLibrary"),
  sideLibrary: $("#sideLibrary"),
  sideSearch: $("#sideSearch"),
  plannedMeals: $("#plannedMeals"),
  hadMeals: $("#hadMeals"),
  groceryList: $("#groceryList"),
  historyList: $("#historyList"),
  periodLabel: $("#periodLabel"),
  plannedCount: $("#plannedCount"),
  groceryCount: $("#groceryCount"),
  hadCount: $("#hadCount"),
  nextListBtn: $("#nextListBtn"),
  refreshHistoryBtn: $("#refreshHistoryBtn"),
  copyGroceryBtn: $("#copyGroceryBtn"),
  toast: $("#toast")
};

function formatDate(value) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function caloriesText(meal) {
  const parts = [];
  if (meal.calories !== null && meal.calories !== undefined) parts.push(`${meal.calories} cal total`);
  if (meal.caloriesPerServing !== null && meal.caloriesPerServing !== undefined) parts.push(`${meal.caloriesPerServing} cal/serving`);
  if (meal.servings) parts.push(`${meal.servings} servings`);
  if (meal.servingSize) parts.push(`Serving: ${meal.servingSize}`);
  return parts;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "The request could not be completed.");
  }
  if (response.status === 204) return null;
  return response.json();
}

function mealPayloadFromForm() {
  return {
    name: elements.mealName.value.trim(),
    ingredients: elements.mealIngredients.value,
    calories: elements.mealCalories.value,
    servings: elements.mealServings.value,
    servingSize: elements.mealServingSize.value
  };
}

function resetForm(kind = "meal") {
  state.editingMealId = null;
  state.editingKind = kind;
  elements.form.reset();
  elements.form.querySelector(".food-kind").hidden = false;
  elements.form.querySelector(`[name="entryType"][value="${kind}"]`).checked = true;
  elements.mealId.value = "";
  elements.formTitle.textContent = `Add a ${kind}`;
  $("#foodNameLabel").textContent = kind === "side" ? "Side name" : "Meal name";
  $("#saveFoodBtn").textContent = `Save ${kind}`;
  elements.foodFormError.textContent = "";
  elements.foodFormError.classList.add("hidden");
  updateCaloriePreview();
}

let dialogOrigin = null;

function openFoodDialog() {
  const origin = document.activeElement;
  dialogOrigin = {
    element: origin,
    selector: origin?.dataset.action === "edit"
      ? `#${state.editingKind === "side" ? "sideLibrary" : "mealLibrary"} button[data-action="edit"][data-id="${state.editingMealId}"]`
      : null,
    x: window.scrollX,
    y: window.scrollY
  };
  document.body.classList.add("modal-open");
  elements.foodDialog.showModal();
  elements.mealName.focus({ preventScroll: true });
}

function restoreDialogOrigin() {
  const origin = dialogOrigin;
  const target = origin?.element?.isConnected ? origin.element : document.querySelector(origin?.selector || "#newMealBtn");
  target?.focus({ preventScroll: true });
  if (origin) window.scrollTo(origin.x, origin.y);
}

function setFoodSaving(saving) {
  state.savingFood = saving;
  elements.form.setAttribute("aria-busy", String(saving));
  elements.foodDialog.querySelectorAll("input, textarea, button").forEach((input) => { input.disabled = saving; });
}

elements.foodDialog.addEventListener("cancel", (event) => {
  if (state.savingFood) event.preventDefault();
});
elements.foodDialog.addEventListener("close", () => {
  document.body.classList.remove("modal-open");
  resetForm();
  restoreDialogOrigin();
});
[$("#closeFoodDialogBtn"), elements.cancelEditBtn].forEach((button) => {
  button.addEventListener("click", () => {
    if (!state.savingFood) elements.foodDialog.close();
  });
});

function updateCaloriePreview() {
  const calories = Number(elements.mealCalories.value);
  const servings = Number(elements.mealServings.value);
  if (Number.isFinite(calories) && calories > 0 && Number.isFinite(servings) && servings > 0) {
    elements.caloriePreview.textContent = `${Math.round((calories / servings) * 10) / 10} calories per serving`;
  } else {
    elements.caloriePreview.textContent = "Calories per serving will appear here.";
  }
}

function renderFoodDetails(meal) {
  const meta = caloriesText(meal);
  return `
    <h3>${escapeHtml(meal.name)}</h3>
    <div class="meta-row">
      ${meta.length ? meta.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("") : `<span>No calorie details</span>`}
    </div>
    <p class="ingredients">${meal.ingredients.length ? escapeHtml(meal.ingredients.join(", ")) : "No ingredients listed."}</p>`;
}

function renderMealCard(meal, context = "library", listMeal = null) {
  let actions = "";
  if (context === "library" || context === "side-library") {
    actions = `
      ${context === "library" ? `<button class="ghost" data-action="plan" data-id="${meal.id}">Add</button>` : ""}
      <button class="ghost" data-action="edit" data-id="${meal.id}">Edit</button>
      <button class="ghost danger" data-action="delete" data-id="${meal.id}">Remove</button>
    `;
  } else if (context === "planned") {
    actions = `
      <button class="ghost" data-action="had" data-list-meal-id="${listMeal.listMealId}">Had</button>
      <button class="ghost danger" data-action="unplan" data-list-meal-id="${listMeal.listMealId}">Remove</button>
    `;
  } else if (context === "had") {
    actions = `
      <button class="ghost" data-action="unhad" data-list-meal-id="${listMeal.listMealId}">Unmark</button>
      <button class="ghost danger" data-action="unplan" data-list-meal-id="${listMeal.listMealId}">Remove</button>
    `;
  }

  return `
    <article class="meal-card">
      <div>
        ${renderFoodDetails(meal)}
      </div>
      <div class="card-actions">${actions}</div>
      ${listMeal ? `<div class="meal-extras">${renderAttachedSides(listMeal, context !== "history")}</div>` : ""}
    </article>
  `;
}

function renderAttachedSides(item, editable) {
  const attached = item.sides || [];
  const keys = new Set(attached.map((side) => side.sharedFoodId));
  const available = state.sides.filter((side) => !keys.has(side.sharedFoodId));
  return `
    ${attached.length ? `<ul class="attached-sides">${attached.map((side) => `
      <li>
        <div>${renderFoodDetails(side)}</div>
        ${editable ? `<div class="card-actions"><button class="ghost danger" type="button" data-action="remove-side" data-list-meal-id="${item.listMealId}" data-attachment-id="${side.attachmentId}" aria-label="Remove ${escapeHtml(side.name)} from ${escapeHtml(item.meal.name)}">Remove side</button></div>` : ""}
      </li>`).join("")}</ul>
      <p class="combined-total"><strong>Combined Total Per Serving: ${item.totalCaloriesPerServing} cal</strong>${item.caloriesIncomplete ? " (known calories only; some calories not provided)" : ""}</p>` : ""}
    ${editable && available.length ? `<details class="side-picker">
      <summary>${attached.length ? "Add more sides" : "Add sides"}</summary>
      <fieldset class="side-options" id="sideFor-${item.listMealId}">
        <legend>Sides for ${escapeHtml(item.meal.name)}</legend>
        ${available.map((side) => `<label><input type="checkbox" value="${side.id}"><span>${escapeHtml(side.name)}</span></label>`).join("")}
      </fieldset>
      <button class="ghost" type="button" data-action="attach-side" data-list-meal-id="${item.listMealId}">Add selected sides</button>
    </details>` : ""}`;
}

function renderSides() {
  const search = state.sideSearch.toLowerCase();
  const foods = state.sides.filter((side) => !search || `${side.name} ${side.ingredients.join(" ")}`.toLowerCase().includes(search));
  elements.sideLibrary.innerHTML = foods.length
    ? foods.map((side) => renderMealCard(side, "side-library")).join("")
    : `<div class="empty">${search ? "No matching sides." : "No sides yet."}</div>`;
}

function renderMeals() {
  const plannedMealIds = new Set((state.activeList?.meals || [])
    .filter((item) => item.status !== "had")
    .map((item) => item.meal.id));

  const meals = state.meals.filter((meal) => {
    const search = state.search.toLowerCase();
    return !search || meal.name.toLowerCase().includes(search) || meal.ingredients.join(" ").toLowerCase().includes(search);
  });

  elements.mealLibrary.innerHTML = meals.length
    ? meals.map((meal) => renderMealCard({ ...meal, alreadyPlanned: plannedMealIds.has(meal.id) })).join("")
    : `<div class="empty">No meals yet. Add one or import a CSV to get started.</div>`;
}

function renderActiveList() {
  const active = state.activeList;
  const planned = (active?.meals || []).filter((item) => item.status !== "had");
  const had = (active?.meals || []).filter((item) => item.status === "had");
  elements.periodLabel.textContent = active ? `${formatDate(active.startDate)} - current` : "No active list";
  elements.plannedCount.textContent = planned.length;
  elements.groceryCount.textContent = active?.groceryItems?.length || 0;
  elements.hadCount.textContent = had.length;

  elements.plannedMeals.innerHTML = planned.length
    ? planned.map((item) => renderMealCard(item.meal, "planned", item)).join("")
    : `<div class="empty">Choose meals from your library to plan this period.</div>`;

  elements.hadMeals.innerHTML = had.length
    ? had.map((item) => renderMealCard(item.meal, "had", item)).join("")
    : `<div class="empty">Meals marked as had for this period will appear here.</div>`;

  elements.groceryList.innerHTML = active?.groceryItems?.length
    ? active.groceryItems.map((item, index) => `
      <div class="grocery-item">
        <label>
          <input type="checkbox" data-grocery-check="${index}">
          <span>${escapeHtml(item.name)}${item.count > 1 ? ` (${item.count})` : ""}</span>
        </label>
        <small>For ${escapeHtml(item.meals.join(", "))}</small>
      </div>
    `).join("")
    : `<div class="empty">Ingredients from planned meals will appear here.</div>`;
}

function renderHistory() {
  elements.historyList.innerHTML = state.history.length
    ? state.history.map((list) => {
      const historyMeals = (had) => list.meals.filter((item) => (item.status === "had") === had)
        .map((item) => renderMealCard(item.meal, "history", item)).join("") || "<p>None</p>";
      return `
        <details class="history-card">
          <summary>${formatDate(list.startDate)} - ${formatDate(list.endDate)}</summary>
          <div class="history-body">
            <h3>Planned, not had</h3>
            <div class="history-meals">${historyMeals(false)}</div>
            <h3>Had</h3>
            <div class="history-meals">${historyMeals(true)}</div>
            <p><strong>Grocery items:</strong> ${list.groceryItems.length ? escapeHtml(list.groceryItems.map((item) => item.name).join(", ")) : "None listed"}</p>
            <button class="ghost danger" data-action="delete-history" data-list-id="${list.id}">Remove list</button>
          </div>
        </details>
      `;
    }).join("")
    : `<div class="empty">Completed lists will appear here after you start the next list.</div>`;
}

function render() {
  renderMeals();
  renderSides();
  renderActiveList();
  renderHistory();
}

async function loadState() {
  const data = await api("/api/state");
  state.meals = data.meals;
  state.sides = data.sides || [];
  state.activeList = data.activeList;
  render();
}

async function loadHistory() {
  state.history = await api("/api/history");
  renderHistory();
}

function editMeal(id, kind = "meal") {
  const meal = (kind === "side" ? state.sides : state.meals).find((item) => item.id === id);
  if (!meal) return;
  resetForm(kind);
  state.editingMealId = id;
  elements.mealId.value = id;
  elements.mealName.value = meal.name;
  elements.mealIngredients.value = meal.ingredients.join("\n");
  elements.mealCalories.value = meal.calories ?? "";
  elements.mealServings.value = meal.servings ?? "";
  elements.mealServingSize.value = meal.servingSize ?? "";
  elements.formTitle.textContent = `Edit ${kind}`;
  elements.form.querySelector(".food-kind").hidden = true;
  updateCaloriePreview();
  openFoodDialog();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows.filter((item) => item.some((cellValue) => cellValue.trim()));
  const normalized = headers.map((header) => header.trim().toLowerCase().replaceAll(" ", "_"));
  const knownHeaders = new Set([
    "name",
    "meal",
    "meal_name",
    "ingredients",
    "calories",
    "total_calories",
    "servings",
    "serving_count",
    "number_of_servings",
    "serving_size",
    "serving_description",
    "serving_size_text"
  ]);
  const hasHeaderRow = normalized.some((header) => knownHeaders.has(header));

  if (!hasHeaderRow) {
    return rows
      .flat()
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        ingredients: "",
        calories: "",
        servings: "",
        servingSize: ""
      }));
  }

  return dataRows.map((dataRow) => {
    const entry = {};
    normalized.forEach((header, index) => {
      entry[header] = dataRow[index]?.trim() || "";
    });
    return {
      name: entry.name || entry.meal || entry.meal_name,
      ingredients: entry.ingredients,
      calories: entry.calories || entry.total_calories,
      servings: entry.servings || entry.serving_count || entry.number_of_servings,
      servingSize: entry.serving_size || entry.serving_description || entry.serving_size_text
    };
  });
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.savingFood) return;
  const payload = mealPayloadFromForm();
  const kind = state.editingKind;
  const endpoint = kind === "side" ? "/api/sides" : "/api/meals";
  if (!payload.name) {
    elements.foodFormError.textContent = `${kind === "side" ? "Side" : "Meal"} name is required.`;
    elements.foodFormError.classList.remove("hidden");
    elements.mealName.focus();
    return;
  }

  elements.foodFormError.classList.add("hidden");
  setFoodSaving(true);
  try {
    if (state.editingMealId) {
      await api(`${endpoint}/${state.editingMealId}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast(kind === "side" ? "Side updated." : "Meal updated.");
    } else {
      await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      showToast(kind === "side" ? "Side added." : "Meal added.");
    }
  } catch (error) {
    elements.foodFormError.textContent = error.message;
    elements.foodFormError.classList.remove("hidden");
    return;
  } finally {
    setFoodSaving(false);
  }
  elements.foodDialog.close("saved");
  try { await loadState(); }
  catch (error) { showToast(error.message); }
  restoreDialogOrigin();
});

elements.form.querySelectorAll('[name="entryType"]').forEach((input) => {
  input.addEventListener("change", () => resetForm(input.value));
});
[$("#quickAddMealBtn"), $("#newMealBtn"), $("#newSideBtn")].forEach((button) => {
  button.addEventListener("click", () => {
    resetForm(button.id === "newSideBtn" ? "side" : "meal");
    openFoodDialog();
  });
});
$("#importMealsBtn").addEventListener("click", () => elements.csvInput.click());
elements.sideSearch.addEventListener("input", () => {
  state.sideSearch = elements.sideSearch.value;
  renderSides();
});
elements.sideLibrary.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  if (button.dataset.action === "edit") return editMeal(id, "side");
  if (button.dataset.action !== "delete" || !confirm("Remove this side from the shared library? Sides already attached to meals will be kept.")) return;
  button.disabled = true;
  try {
    await api(`/api/sides/${id}`, { method: "DELETE" });
    await loadState();
    if (state.editingKind === "side" && state.editingMealId === id) resetForm("side");
    showToast("Side removed from library.");
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

async function changeAttachedSide(button) {
  const id = Number(button.dataset.listMealId);
  const path = `/api/list/meals/${id}/sides`;
  button.disabled = true;
  try {
    if (button.dataset.action === "attach-side") {
      const sideIds = [...document.getElementById(`sideFor-${id}`).querySelectorAll("input:checked")].map((input) => Number(input.value));
      if (!sideIds.length) return showToast("Choose at least one side first.");
      state.activeList = await api(path, { method: "POST", body: JSON.stringify({ sideIds }) });
    } else {
      state.activeList = await api(`${path}/${button.dataset.attachmentId}`, { method: "DELETE" });
    }
    render();
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
}

elements.mealLibrary.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const id = Number(button.dataset.id);

  try {
    if (button.dataset.action === "plan") {
      state.activeList = await api("/api/list/meals", { method: "POST", body: JSON.stringify({ mealId: id }) });
      showToast("Meal added to this list.");
    }
    if (button.dataset.action === "edit") return editMeal(id);
    if (button.dataset.action === "delete") {
      if (!confirm("Remove this meal from the meal library?")) return;
      await api(`/api/meals/${id}`, { method: "DELETE" });
      showToast("Meal removed.");
      await loadState();
    }
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.plannedMeals.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (["attach-side", "remove-side"].includes(button.dataset.action)) return changeAttachedSide(button);
  const id = Number(button.dataset.listMealId);

  try {
    if (button.dataset.action === "had") {
      state.activeList = await api(`/api/list/meals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "had" })
      });
      showToast("Marked as had.");
    }
    if (button.dataset.action === "unplan") {
      await api(`/api/list/meals/${id}`, { method: "DELETE" });
      await loadState();
      showToast("Removed from this list.");
    }
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.hadMeals.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (["attach-side", "remove-side"].includes(button.dataset.action)) return changeAttachedSide(button);
  const id = Number(button.dataset.listMealId);

  try {
    if (button.dataset.action === "unhad") {
      state.activeList = await api(`/api/list/meals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "planned" })
      });
      showToast("Moved back to meals to have.");
    }
    if (button.dataset.action === "unplan") {
      await api(`/api/list/meals/${id}`, { method: "DELETE" });
      await loadState();
      showToast("Removed from this list.");
    }
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.nextListBtn.addEventListener("click", async () => {
  if (!confirm("End the current list and start a new one?")) return;
  try {
    state.activeList = await api("/api/list/next", { method: "POST" });
    await loadHistory();
    await loadState();
    showToast("New list started.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.historyList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.dataset.action !== "delete-history") return;
  if (!confirm("Remove this previous list? This will not delete meals from your meal library.")) return;

  try {
    await api(`/api/history/${button.dataset.listId}`, { method: "DELETE" });
    await loadHistory();
    showToast("Previous list removed.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.csvInput.addEventListener("change", async () => {
  const file = elements.csvInput.files?.[0];
  if (!file) return;
  try {
    const meals = parseCsv(await file.text());
    const result = await api("/api/meals/import", {
      method: "POST",
      body: JSON.stringify({ meals })
    });
    await loadState();
    showToast(`Imported ${result.imported.length} meal${result.imported.length === 1 ? "" : "s"}.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.csvInput.value = "";
  }
});

elements.copyGroceryBtn.addEventListener("click", async () => {
  const items = state.activeList?.groceryItems || [];
  if (!items.length) return showToast("No grocery items to copy.");
  await navigator.clipboard.writeText(items.map((item) => `${item.name}${item.count > 1 ? ` (${item.count})` : ""}`).join("\n"));
  showToast("Grocery list copied.");
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-collapse-target]");
  if (!button) return;

  const target = document.getElementById(button.dataset.collapseTarget);
  if (!target) return;

  const isCollapsed = target.classList.toggle("collapsed");
  button.setAttribute("aria-expanded", String(!isCollapsed));
  button.textContent = isCollapsed ? "Expand" : "Collapse";
});

elements.refreshHistoryBtn.addEventListener("click", loadHistory);
elements.mealSearch.addEventListener("input", () => {
  state.search = elements.mealSearch.value;
  renderMeals();
});
elements.mealCalories.addEventListener("input", updateCaloriePreview);
elements.mealServings.addEventListener("input", updateCaloriePreview);

await loadState();
await loadHistory();
