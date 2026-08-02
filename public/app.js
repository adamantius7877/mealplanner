const state = {
  meals: [],
  activeList: null,
  history: [],
  editingMealId: null,
  search: ""
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#mealForm"),
  mealId: $("#mealId"),
  mealName: $("#mealName"),
  mealIngredients: $("#mealIngredients"),
  mealCalories: $("#mealCalories"),
  mealServings: $("#mealServings"),
  caloriePreview: $("#caloriePreview"),
  formTitle: $("#formTitle"),
  cancelEditBtn: $("#cancelEditBtn"),
  csvInput: $("#csvInput"),
  mealSearch: $("#mealSearch"),
  mealLibrary: $("#mealLibrary"),
  plannedMeals: $("#plannedMeals"),
  groceryList: $("#groceryList"),
  historyList: $("#historyList"),
  periodLabel: $("#periodLabel"),
  plannedCount: $("#plannedCount"),
  groceryCount: $("#groceryCount"),
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
  if (meal.caloriesPerServing) parts.push(`${meal.caloriesPerServing} cal/serving`);
  if (meal.servings) parts.push(`${meal.servings} servings`);
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
    servings: elements.mealServings.value
  };
}

function resetForm() {
  state.editingMealId = null;
  elements.form.reset();
  elements.mealId.value = "";
  elements.formTitle.textContent = "Add a meal";
  elements.cancelEditBtn.classList.add("hidden");
  updateCaloriePreview();
}

function updateCaloriePreview() {
  const calories = Number(elements.mealCalories.value);
  const servings = Number(elements.mealServings.value);
  if (Number.isFinite(calories) && calories > 0 && Number.isFinite(servings) && servings > 0) {
    elements.caloriePreview.textContent = `${Math.round((calories / servings) * 10) / 10} calories per serving`;
  } else {
    elements.caloriePreview.textContent = "Calories per serving will appear here.";
  }
}

function renderMealCard(meal, context = "library", listMeal = null) {
  const meta = caloriesText(meal);
  const ingredients = meal.ingredients.length
    ? `<p class="ingredients">${escapeHtml(meal.ingredients.join(", "))}</p>`
    : `<p class="ingredients">No ingredients listed.</p>`;

  let actions = "";
  if (context === "library") {
    actions = `
      <button class="ghost" data-action="plan" data-id="${meal.id}">Add</button>
      <button class="ghost" data-action="edit" data-id="${meal.id}">Edit</button>
      <button class="ghost danger" data-action="delete" data-id="${meal.id}">Remove</button>
    `;
  } else {
    actions = `
      <button class="ghost" data-action="had" data-list-meal-id="${listMeal.listMealId}">Had</button>
      <button class="ghost danger" data-action="unplan" data-list-meal-id="${listMeal.listMealId}">Remove</button>
    `;
  }

  return `
    <article class="meal-card">
      <div>
        <h3>${escapeHtml(meal.name)}</h3>
        <div class="meta-row">
          ${meta.length ? meta.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("") : `<span>No calorie details</span>`}
        </div>
        ${ingredients}
      </div>
      <div class="card-actions">${actions}</div>
    </article>
  `;
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
  elements.periodLabel.textContent = active ? `${formatDate(active.startDate)} - current` : "No active list";
  elements.plannedCount.textContent = planned.length;
  elements.groceryCount.textContent = active?.groceryItems?.length || 0;

  elements.plannedMeals.innerHTML = planned.length
    ? planned.map((item) => renderMealCard(item.meal, "planned", item)).join("")
    : `<div class="empty">Choose meals from your library to plan this period.</div>`;

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
      const meals = list.meals.map((item) => item.meal.name).join(", ") || "No meals recorded";
      return `
        <details class="history-card">
          <summary>${formatDate(list.startDate)} - ${formatDate(list.endDate)}</summary>
          <div class="history-body">
            <p><strong>Meals:</strong> ${escapeHtml(meals)}</p>
            <p><strong>Grocery items:</strong> ${list.groceryItems.length ? escapeHtml(list.groceryItems.map((item) => item.name).join(", ")) : "None listed"}</p>
          </div>
        </details>
      `;
    }).join("")
    : `<div class="empty">Completed lists will appear here after you start the next list.</div>`;
}

function render() {
  renderMeals();
  renderActiveList();
  renderHistory();
}

async function loadState() {
  const data = await api("/api/state");
  state.meals = data.meals;
  state.activeList = data.activeList;
  render();
}

async function loadHistory() {
  state.history = await api("/api/history");
  renderHistory();
}

function editMeal(id) {
  const meal = state.meals.find((item) => item.id === id);
  if (!meal) return;
  state.editingMealId = id;
  elements.mealId.value = id;
  elements.mealName.value = meal.name;
  elements.mealIngredients.value = meal.ingredients.join("\n");
  elements.mealCalories.value = meal.calories ?? "";
  elements.mealServings.value = meal.servings ?? "";
  elements.formTitle.textContent = "Edit meal";
  elements.cancelEditBtn.classList.remove("hidden");
  updateCaloriePreview();
  elements.mealName.focus();
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
  const knownHeaders = new Set(["name", "meal", "meal_name", "ingredients", "calories", "total_calories", "servings", "serving_size"]);
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
        servings: ""
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
      servings: entry.servings || entry.serving_size
    };
  });
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = mealPayloadFromForm();
  if (!payload.name) return showToast("Meal name is required.");

  try {
    if (state.editingMealId) {
      await api(`/api/meals/${state.editingMealId}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Meal updated.");
    } else {
      await api("/api/meals", { method: "POST", body: JSON.stringify(payload) });
      showToast("Meal added.");
    }
    resetForm();
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
});

elements.mealLibrary.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const id = Number(button.dataset.id);

  try {
    if (button.dataset.action === "plan") {
      state.activeList = await api("/api/list/meals", { method: "POST", body: JSON.stringify({ mealId: id }) });
      showToast("Meal added to this list.");
    }
    if (button.dataset.action === "edit") editMeal(id);
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

elements.cancelEditBtn.addEventListener("click", resetForm);
elements.refreshHistoryBtn.addEventListener("click", loadHistory);
elements.mealSearch.addEventListener("input", () => {
  state.search = elements.mealSearch.value;
  renderMeals();
});
elements.mealCalories.addEventListener("input", updateCaloriePreview);
elements.mealServings.addEventListener("input", updateCaloriePreview);

await loadState();
await loadHistory();
