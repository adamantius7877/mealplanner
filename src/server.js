import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "meals.db");
const publicDir = path.join(__dirname, "..", "public");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ingredients TEXT NOT NULL DEFAULT '[]',
    calories INTEGER,
    servings REAL,
    serving_size TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meal_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS list_meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES meal_lists(id) ON DELETE CASCADE,
    meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'planned',
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    had_at TEXT,
    UNIQUE(list_id, meal_id)
  );
`);

const mealColumns = db.prepare("PRAGMA table_info(meals)").all().map((column) => column.name);
if (!mealColumns.includes("serving_size")) {
  db.exec("ALTER TABLE meals ADD COLUMN serving_size TEXT NOT NULL DEFAULT ''");
}

const isoDate = () => new Date().toISOString();

function ensureActiveList() {
  let active = db.prepare("SELECT * FROM meal_lists WHERE end_date IS NULL ORDER BY id DESC LIMIT 1").get();
  if (!active) {
    const start = isoDate();
    const result = db.prepare("INSERT INTO meal_lists (start_date) VALUES (?)").run(start);
    active = db.prepare("SELECT * FROM meal_lists WHERE id = ?").get(result.lastInsertRowid);
  }
  return active;
}

function parseIngredients(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) return [];
  return String(value)
    .split(/\r?\n|;|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mealFromRow(row) {
  const ingredients = JSON.parse(row.ingredients || "[]");
  const calories = row.calories === null || row.calories === undefined ? null : Number(row.calories);
  const servings = row.servings === null || row.servings === undefined ? null : Number(row.servings);
  return {
    id: row.id,
    name: row.name,
    ingredients,
    calories,
    servings,
    servingSize: row.serving_size || "",
    caloriesPerServing: calories && servings ? Math.round((calories / servings) * 10) / 10 : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listFromRow(row) {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at
  };
}

function validateMealPayload(payload) {
  const name = String(payload.name || "").trim();
  if (!name) {
    const error = new Error("Meal name is required.");
    error.status = 400;
    throw error;
  }

  const calories = payload.calories === "" || payload.calories === null || payload.calories === undefined
    ? null
    : Number(payload.calories);
  const servings = payload.servings === "" || payload.servings === null || payload.servings === undefined
    ? null
    : Number(payload.servings);

  if (calories !== null && (!Number.isFinite(calories) || calories < 0)) {
    const error = new Error("Calories must be a positive number.");
    error.status = 400;
    throw error;
  }

  if (servings !== null && (!Number.isFinite(servings) || servings <= 0)) {
    const error = new Error("Serving size must be greater than zero.");
    error.status = 400;
    throw error;
  }

  return {
    name,
    ingredients: parseIngredients(payload.ingredients),
    calories: calories === null ? null : Math.round(calories),
    servings,
    servingSize: String(payload.servingSize || payload.serving_size || "").trim()
  };
}

function getMealsForList(listId) {
  return db.prepare(`
    SELECT
      list_meals.id AS listMealId,
      list_meals.status,
      list_meals.added_at AS addedAt,
      list_meals.had_at AS hadAt,
      meals.*
    FROM list_meals
    JOIN meals ON meals.id = list_meals.meal_id
    WHERE list_meals.list_id = ?
    ORDER BY list_meals.status ASC, list_meals.added_at ASC
  `).all(listId).map((row) => ({
    listMealId: row.listMealId,
    status: row.status,
    addedAt: row.addedAt,
    hadAt: row.hadAt,
    meal: mealFromRow(row)
  }));
}

function groceryItems(listMeals) {
  const counts = new Map();
  for (const item of listMeals) {
    if (item.status === "had") continue;
    for (const ingredient of item.meal.ingredients) {
      const key = ingredient.toLowerCase();
      const current = counts.get(key) || { name: ingredient, count: 0, meals: [] };
      current.count += 1;
      current.meals.push(item.meal.name);
      counts.set(key, current);
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function activeListDetails() {
  const list = ensureActiveList();
  const listMeals = getMealsForList(list.id);
  return {
    ...listFromRow(list),
    meals: listMeals,
    groceryItems: groceryItems(listMeals)
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Invalid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sendFile(res, urlPath) {
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function matchRoute(method, pathname, pattern) {
  const methodMatches = method === pattern.method;
  if (!methodMatches) return null;
  const routeParts = pattern.path.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (routeParts.length !== pathParts.length) return null;

  const params = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index];
    const pathPart = pathParts[index];
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = pathPart;
    } else if (routePart !== pathPart) {
      return null;
    }
  }
  return params;
}

const routes = [];
const route = (method, pathPattern, handler) => routes.push({ method, path: pathPattern, handler });

route("GET", "/api/state", (_req, res) => {
  const meals = db.prepare("SELECT * FROM meals ORDER BY name COLLATE NOCASE").all().map(mealFromRow);
  const activeList = activeListDetails();
  sendJson(res, 200, { meals, activeList });
});

route("GET", "/api/history", (_req, res) => {
  const lists = db.prepare("SELECT * FROM meal_lists WHERE end_date IS NOT NULL ORDER BY start_date DESC").all();
  sendJson(res, 200, lists.map((list) => {
    const meals = getMealsForList(list.id);
    return {
      ...listFromRow(list),
      meals,
      groceryItems: groceryItems(meals)
    };
  }));
});

route("DELETE", "/api/history/:listId", (_req, res, params) => {
  const result = db.prepare("DELETE FROM meal_lists WHERE id = ? AND end_date IS NOT NULL").run(params.listId);
  if (!result.changes) return sendJson(res, 404, { error: "Previous list not found." });
  sendNoContent(res);
});

route("POST", "/api/meals", async (req, res) => {
  const meal = validateMealPayload(await readJson(req));
  const result = db.prepare(`
    INSERT INTO meals (name, ingredients, calories, servings, serving_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(meal.name, JSON.stringify(meal.ingredients), meal.calories, meal.servings, meal.servingSize, isoDate());
  sendJson(res, 201, mealFromRow(db.prepare("SELECT * FROM meals WHERE id = ?").get(result.lastInsertRowid)));
});

route("POST", "/api/meals/import", async (req, res) => {
  const body = await readJson(req);
  const rows = Array.isArray(body.meals) ? body.meals : [];
  const insert = db.prepare(`
    INSERT INTO meals (name, ingredients, calories, servings, serving_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const imported = [];
  const skipped = [];

  db.exec("BEGIN");
  try {
    rows.forEach((row, index) => {
      try {
        const meal = validateMealPayload(row);
        const result = insert.run(meal.name, JSON.stringify(meal.ingredients), meal.calories, meal.servings, meal.servingSize, isoDate());
        imported.push(mealFromRow(db.prepare("SELECT * FROM meals WHERE id = ?").get(result.lastInsertRowid)));
      } catch (error) {
        skipped.push({ row: index + 1, reason: error.message });
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  sendJson(res, 201, { imported, skipped });
});

route("PUT", "/api/meals/:id", async (req, res, params) => {
  const meal = validateMealPayload(await readJson(req));
  const result = db.prepare(`
    UPDATE meals
    SET name = ?, ingredients = ?, calories = ?, servings = ?, serving_size = ?, updated_at = ?
    WHERE id = ?
  `).run(meal.name, JSON.stringify(meal.ingredients), meal.calories, meal.servings, meal.servingSize, isoDate(), params.id);

  if (!result.changes) return sendJson(res, 404, { error: "Meal not found." });
  sendJson(res, 200, mealFromRow(db.prepare("SELECT * FROM meals WHERE id = ?").get(params.id)));
});

route("DELETE", "/api/meals/:id", (_req, res, params) => {
  const result = db.prepare("DELETE FROM meals WHERE id = ?").run(params.id);
  if (!result.changes) return sendJson(res, 404, { error: "Meal not found." });
  sendNoContent(res);
});

route("POST", "/api/list/meals", async (req, res) => {
  const list = ensureActiveList();
  const body = await readJson(req);
  const mealId = Number(body.mealId);
  const exists = db.prepare("SELECT id FROM meals WHERE id = ?").get(mealId);
  if (!exists) return sendJson(res, 404, { error: "Meal not found." });

  db.prepare(`
    INSERT INTO list_meals (list_id, meal_id)
    VALUES (?, ?)
    ON CONFLICT(list_id, meal_id) DO UPDATE SET status = 'planned', had_at = NULL
  `).run(list.id, mealId);

  sendJson(res, 201, activeListDetails());
});

route("PATCH", "/api/list/meals/:listMealId", async (req, res, params) => {
  const body = await readJson(req);
  const status = body.status === "had" ? "had" : "planned";
  const hadAt = status === "had" ? isoDate() : null;
  const result = db.prepare("UPDATE list_meals SET status = ?, had_at = ? WHERE id = ?")
    .run(status, hadAt, params.listMealId);
  if (!result.changes) return sendJson(res, 404, { error: "Meal list item not found." });
  sendJson(res, 200, activeListDetails());
});

route("DELETE", "/api/list/meals/:listMealId", (_req, res, params) => {
  const result = db.prepare("DELETE FROM list_meals WHERE id = ?").run(params.listMealId);
  if (!result.changes) return sendJson(res, 404, { error: "Meal list item not found." });
  sendNoContent(res);
});

route("POST", "/api/list/next", (_req, res) => {
  const active = ensureActiveList();
  db.prepare("UPDATE meal_lists SET end_date = ? WHERE id = ? AND end_date IS NULL").run(isoDate(), active.id);
  ensureActiveList();
  sendJson(res, 201, activeListDetails());
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    for (const pattern of routes) {
      const params = matchRoute(req.method, url.pathname, pattern);
      if (params) {
        await pattern.handler(req, res, params);
        return;
      }
    }
    if (req.method === "GET") {
      sendFile(res, decodeURIComponent(url.pathname));
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, error.status || 500, { error: error.message || "Something went wrong." });
    } else {
      res.end();
    }
  }
});

server.listen(port, () => {
  console.log(`Meals and Grocery Dashboard running at http://localhost:${port}`);
});
