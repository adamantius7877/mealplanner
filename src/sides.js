import { randomUUID } from "node:crypto";

export function createSides({ db, hasSharedFoodLibrary, sharedFoodRequest, validateMealPayload, mealFromRow, mealFromSharedFood }) {
  db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS sides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ingredients TEXT NOT NULL DEFAULT '[]',
      calories INTEGER,
      servings REAL,
      serving_size TEXT NOT NULL DEFAULT '',
      shared_food_id TEXT NOT NULL UNIQUE,
      shared_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS list_meal_sides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_meal_id INTEGER NOT NULL REFERENCES list_meals(id) ON DELETE CASCADE,
      side_key TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(list_meal_id, side_key)
    );
    COMMIT;
  `);

  const error = (message, status = 400) => Object.assign(new Error(message), { status });
  const localSide = (id) => db.prepare("SELECT * FROM sides WHERE id = ?").get(id);
  const insert = (food, key, synced) => db.prepare(`
    INSERT INTO sides (name, ingredients, calories, servings, serving_size, shared_food_id, shared_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(food.name, JSON.stringify(food.ingredients), food.calories, food.servings, food.servingSize, key, synced);
  const update = (id, food, synced) => db.prepare(`
    UPDATE sides SET name = ?, ingredients = ?, calories = ?, servings = ?, serving_size = ?,
      shared_synced = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(food.name, JSON.stringify(food.ingredients), food.calories, food.servings, food.servingSize, synced, id);

  async function upload(food, key) {
    const capabilities = await sharedFoodRequest("?type=side");
    if (!capabilities?.supportedTypes?.includes("side")) {
      throw error("Deploy the CaloriesDashboard Side update before saving shared sides.", 502);
    }
    const payload = {
      ...capabilities.foods?.find((item) => item.id === key),
      id: key, type: "side", name: food.name, calories: food.calories || 1,
      servings: food.servings, serving: food.servingSize,
      ingredients: food.ingredients.join("\n"),
      source: capabilities.foods?.find((item) => item.id === key)?.source || "MealsAndGroceryDashboard"
    };
    const body = await sharedFoodRequest("", { method: "POST", body: JSON.stringify(payload) });
    if (body?.food?.type !== "side") {
      throw error("Update CaloriesDashboard to support Side foods before saving shared sides.", 502);
    }
    return mealFromSharedFood(body.food);
  }

  async function library() {
    if (!hasSharedFoodLibrary()) {
      return db.prepare("SELECT * FROM sides ORDER BY name COLLATE NOCASE").all().map(mealFromRow);
    }
    // Persist the UUID before upload so a retry cannot create a second shared food.
    for (const row of db.prepare("SELECT * FROM sides WHERE shared_synced = 0").all()) {
      const food = await upload(mealFromRow(row), row.shared_food_id);
      update(row.id, food, 1);
    }
    const body = await sharedFoodRequest("?type=side");
    if (!Array.isArray(body?.foods) || body.configured === false) {
      throw error("The shared side library returned an invalid response.", 502);
    }
    const ids = new Set();
    for (const row of body.foods) {
      // Older APIs may ignore an unknown type filter and return every food.
      if (row.type !== "side" || !row.id || !row.name) continue;
      const food = mealFromSharedFood(row);
      const existing = db.prepare("SELECT id FROM sides WHERE shared_food_id = ?").get(food.sharedFoodId);
      if (existing) update(existing.id, food, 1);
      else insert(food, food.sharedFoodId, 1);
      ids.add(food.sharedFoodId);
    }
    return db.prepare("SELECT * FROM sides ORDER BY name COLLATE NOCASE").all()
      .filter((row) => ids.has(row.shared_food_id)).map(mealFromRow);
  }

  function forMeal(listMealId) {
    return db.prepare("SELECT id, snapshot FROM list_meal_sides WHERE list_meal_id = ? ORDER BY id")
      .all(listMealId).map((row) => ({ ...JSON.parse(row.snapshot), attachmentId: row.id }));
  }

  function totals(meal, attachments) {
    const foods = [meal, ...attachments];
    return {
      totalCalories: Math.round(foods.reduce((sum, food) => sum + (food.calories ?? 0), 0) * 10) / 10,
      totalCaloriesPerServing: Math.round(foods.reduce((sum, food) => {
        const servings = food.servings > 0 ? food.servings : 1;
        return sum + (food.calories ?? 0) / servings;
      }, 0) * 10) / 10,
      caloriesIncomplete: foods.some((food) => food.calories == null)
    };
  }

  function activeMeal(id) {
    const row = db.prepare(`
      SELECT list_meals.* FROM list_meals JOIN meal_lists ON meal_lists.id = list_meals.list_id
      WHERE list_meals.id = ? AND meal_lists.end_date IS NULL
    `).get(id);
    if (!row) throw error("Current list meal not found.", 404);
    return row;
  }

  function registerRoutes({ route, sendJson, sendNoContent, readJson, activeListDetails }) {
    route("POST", "/api/sides", async (req, res) => {
      let food = validateMealPayload(await readJson(req));
      const key = `mealplanner-side-${randomUUID()}`;
      if (hasSharedFoodLibrary()) food = await upload(food, key);
      const result = insert(food, key, hasSharedFoodLibrary() ? 1 : 0);
      sendJson(res, 201, mealFromRow(localSide(result.lastInsertRowid)));
    });
    route("PUT", "/api/sides/:id", async (req, res, params) => {
      const row = localSide(params.id);
      if (!row) throw error("Side not found.", 404);
      let food = validateMealPayload(await readJson(req));
      if (hasSharedFoodLibrary()) food = await upload(food, row.shared_food_id);
      update(row.id, food, hasSharedFoodLibrary() ? 1 : 0);
      sendJson(res, 200, mealFromRow(localSide(row.id)));
    });
    route("DELETE", "/api/sides/:id", async (_req, res, params) => {
      const row = localSide(params.id);
      if (!row) throw error("Side not found.", 404);
      if (hasSharedFoodLibrary() && row.shared_synced) {
        await sharedFoodRequest(`/${encodeURIComponent(row.shared_food_id)}`, { method: "DELETE" });
      }
      // Attachments contain snapshots, so no meal or history record is deleted here.
      db.prepare("DELETE FROM sides WHERE id = ?").run(row.id);
      sendNoContent(res);
    });
    route("POST", "/api/list/meals/:listMealId/sides", async (req, res, params) => {
      const body = await readJson(req);
      const ids = [...new Set((Array.isArray(body.sideIds) ? body.sideIds : [body.sideId]).map(Number))];
      if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw error("Choose at least one valid side.");
      }
      const available = await library();
      activeMeal(params.listMealId);
      const foods = ids.map((id) => available.find((item) => item.id === id));
      if (foods.some((food) => !food)) throw error("A selected side is no longer available. Refresh the side library.", 404);
      const attach = db.prepare(`
        INSERT INTO list_meal_sides (list_meal_id, side_key, snapshot) VALUES (?, ?, ?)
        ON CONFLICT(list_meal_id, side_key) DO NOTHING
      `);
      db.exec("BEGIN");
      try {
        for (const food of foods) attach.run(params.listMealId, food.sharedFoodId, JSON.stringify(food));
        db.exec("COMMIT");
      } catch (failure) {
        db.exec("ROLLBACK");
        throw failure;
      }
      sendJson(res, 201, activeListDetails());
    });
    route("DELETE", "/api/list/meals/:listMealId/sides/:attachmentId", (_req, res, params) => {
      activeMeal(params.listMealId);
      const result = db.prepare("DELETE FROM list_meal_sides WHERE id = ? AND list_meal_id = ?")
        .run(params.attachmentId, params.listMealId);
      if (!result.changes) throw error("Attached side not found.", 404);
      sendJson(res, 200, activeListDetails());
    });
  }

  function copyAttachments(from, to) {
    db.prepare(`
      INSERT INTO list_meal_sides (list_meal_id, side_key, snapshot)
      SELECT ?, side_key, snapshot FROM list_meal_sides WHERE list_meal_id = ?
    `).run(to, from);
  }

  return { library, forMeal, totals, copyAttachments, registerRoutes };
}
