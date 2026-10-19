import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(new URL("../src/server.js", import.meta.url));
const cleanup = new WeakMap();

async function workspace(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mealplanner-sides-"));
  const actions = [() => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })];
  cleanup.set(t, actions);
  t.after(async () => {
    for (const action of actions.reverse()) await action();
  });
  return dir;
}

async function start(t, dir, sharedUrl = "") {
  const child = spawn(process.execPath, ["--no-warnings", serverPath], {
    cwd: dir,
    env: { ...process.env, PORT: "0", DB_PATH: path.join(dir, "meals.db"), SHARED_FOOD_SERVER: "", SHARED_FOOD_API_URL: sharedUrl },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const stopped = new Promise((resolve) => child.once("close", resolve));
  const stop = async () => {
    if (child.exitCode === null && !child.killed) child.kill();
    await stopped;
  };
  cleanup.get(t).push(stop);
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timeout: ${output}`)); }, 15000);
    child.stderr.on("data", (data) => { output += data; });
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/running at (http:\/\/localhost:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Server exited: ${output}`)); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return {
    stop,
    async request(route, method = "GET", body, status = 200) {
      const response = await fetch(base + route, {
        method, headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const data = response.status === 204 ? null : await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      return data;
    }
  };
}

async function sharedServer(t, { old = false } = {}) {
  const foods = new Map();
  const writes = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") {
      const type = url.searchParams.get("type");
      const body = { configured: true, foods: [...foods.values()].filter((food) => old || !type || food.type === type) };
      if (!old) body.supportedTypes = ["meal", "meal-non-grocery", "restaurant", "drink", "side"];
      res.end(JSON.stringify(body));
    } else if (req.method === "POST") {
      let text = "";
      for await (const chunk of req) text += chunk;
      const food = JSON.parse(text);
      if (old) food.type = "meal";
      foods.set(food.id, food);
      writes.push(food);
      res.end(JSON.stringify({ ok: true, food }));
    } else if (req.method === "DELETE") {
      foods.delete(decodeURIComponent(url.pathname.split("/").pop()));
      res.statusCode = 204;
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.get(t).push(() => new Promise((resolve) => server.close(resolve)));
  return { foods, writes, url: `http://127.0.0.1:${server.address().port}/api/foods` };
}

test("upgrade backs up WAL data, preserves all old rows, and is repeatable", async (t) => {
  const dir = await workspace(t);
  const filename = path.join(dir, "meals.db");
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE meals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      ingredients TEXT NOT NULL DEFAULT '[]', calories INTEGER, servings REAL,
      serving_size TEXT NOT NULL DEFAULT '', shared_food_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE meal_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL,
      end_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE list_meals (id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES meal_lists(id) ON DELETE CASCADE,
      meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'planned', added_at TEXT DEFAULT CURRENT_TIMESTAMP, had_at TEXT,
      UNIQUE(list_id, meal_id));
    INSERT INTO meals (id, name, ingredients, calories, servings, serving_size, shared_food_id)
      VALUES (77, 'Original meal', '["Rice"]', 800, 4, 'One cup', 'original-shared-id');
    INSERT INTO meal_lists (id, start_date, end_date) VALUES (50, '2026-01-01', '2026-01-08'), (51, '2026-01-08', NULL);
    INSERT INTO list_meals (id, list_id, meal_id, status, had_at) VALUES
      (100, 50, 77, 'had', '2026-01-02'), (101, 51, 77, 'planned', NULL);
  `);
  const tables = ["meals", "meal_lists", "list_meals"];
  const original = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
  const app = await start(t, dir);
  const state = await app.request("/api/state");
  assert.equal(state.activeList.meals[0].meal.id, 77);
  assert.deepEqual(state.activeList.meals[0].sides, []);
  for (let index = 0; index < tables.length; index++) {
    assert.deepEqual(db.prepare(`SELECT * FROM ${tables[index]}`).all(), original[index]);
  }
  const backups = await readdir(path.join(dir, "backups"));
  assert.equal(backups.length, 1);
  const saved = new DatabaseSync(path.join(dir, "backups", backups[0]));
  for (let index = 0; index < tables.length; index++) {
    assert.deepEqual(saved.prepare(`SELECT * FROM ${tables[index]}`).all(), original[index]);
  }
  saved.close();
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
  await app.stop();
  const restarted = await start(t, dir);
  assert.equal((await restarted.request("/api/state")).activeList.meals[0].listMealId, 101);
  assert.equal((await readdir(path.join(dir, "backups"))).length, 1);
});

test("side CRUD, attachment isolation, totals, groceries, history and carry-forward", async (t) => {
  const dir = await workspace(t);
  const app = await start(t, dir);
  const req = app.request;
  const main = await req("/api/meals", "POST", { name: "Chicken", calories: 800, servings: 4, ingredients: ["Chicken", "Salt"] }, 201);
  const other = await req("/api/meals", "POST", { name: "Fish", calories: 500, ingredients: ["Fish"] }, 201);
  await req("/api/list/meals", "POST", { mealId: main.id }, 201);
  let list = await req("/api/list/meals", "POST", { mealId: other.id }, 201);
  const mainId = list.meals.find((item) => item.meal.id === main.id).listMealId;
  const otherId = list.meals.find((item) => item.meal.id === other.id).listMealId;
  await req("/api/sides", "POST", { name: "" }, 400);
  await req("/api/sides", "POST", { name: "Invalid", calories: -1 }, 400);
  await req("/api/sides", "POST", { name: "Invalid", servings: 0 }, 400);
  const rice = await req("/api/sides", "POST", { name: "Rice", calories: 200, servings: 2, servingSize: "One cup", ingredients: ["Rice", "salt"] }, 201);
  const veg = await req("/api/sides", "POST", { name: "Peas", calories: 80, ingredients: ["Peas"] }, 201);
  const attach = `/api/list/meals/${mainId}/sides`;
  list = await req(attach, "POST", { sideId: rice.id }, 201);
  list = await req(attach, "POST", { sideId: rice.id }, 201);
  let planned = list.meals.find((item) => item.listMealId === mainId);
  assert.equal(planned.sides.length, 1);
  assert.equal(planned.sides[0].caloriesPerServing, 100);
  assert.equal(planned.totalCalories, 1000);
  assert.equal(planned.totalCaloriesPerServing, 300);
  assert.equal(list.meals.find((item) => item.listMealId === otherId).sides.length, 0);
  assert.equal(list.groceryItems.find((item) => item.name === "Salt").count, 2);
  assert.ok(list.groceryItems.some((item) => item.name === "Rice"));
  list = await req(attach, "POST", { sideId: veg.id }, 201);
  planned = list.meals.find((item) => item.listMealId === mainId);
  assert.equal(planned.totalCalories, 1080);
  assert.equal(planned.totalCaloriesPerServing, 380);
  const vegAttachment = planned.sides.find((item) => item.id === veg.id).attachmentId;
  await req(`/api/list/meals/${otherId}/sides/${vegAttachment}`, "DELETE", undefined, 404);
  list = await req(`${attach}/${vegAttachment}`, "DELETE");
  assert.ok(!list.groceryItems.some((item) => item.name === "Peas"));
  await req("/api/sides/" + rice.id, "PUT", { name: "New rice", calories: 900, ingredients: ["Butter"] });
  list = (await req("/api/state")).activeList;
  assert.equal(list.meals.find((item) => item.listMealId === mainId).sides[0].name, "Rice");
  await req("/api/sides/" + rice.id, "DELETE", undefined, 204);
  list = await req(`/api/list/meals/${mainId}`, "PATCH", { status: "had" });
  assert.ok(!list.groceryItems.some((item) => item.name === "Rice"));
  list = await req(`/api/list/meals/${mainId}`, "PATCH", { status: "planned" });
  assert.ok(list.groceryItems.some((item) => item.name === "Rice"));
  await req(`/api/list/meals/${otherId}/sides`, "POST", { sideId: veg.id }, 201);
  await req(`/api/list/meals/${otherId}`, "PATCH", { status: "had" });
  const next = await req("/api/list/next", "POST", undefined, 201);
  assert.equal(next.meals.length, 1);
  assert.equal(next.meals[0].sides[0].name, "Rice");
  assert.equal(next.meals[0].totalCalories, 1000);
  assert.equal(next.meals[0].totalCaloriesPerServing, 300);
  const history = await req("/api/history");
  const saved = history[0].meals.find((item) => item.listMealId === mainId);
  assert.equal(saved.sides[0].name, "Rice");
  assert.equal(saved.totalCaloriesPerServing, 300);
  assert.equal(history[0].meals.find((item) => item.listMealId === otherId).sides[0].name, "Peas");
  await req(attach, "POST", { sideId: veg.id }, 404);
  await req(`${attach}/${saved.sides[0].attachmentId}`, "DELETE", undefined, 404);
  await req(`/api/list/meals/${next.meals[0].listMealId}/sides/${next.meals[0].sides[0].attachmentId}`, "DELETE");
  assert.equal((await req("/api/history"))[0].meals.find((item) => item.listMealId === mainId).sides.length, 1);
  await app.stop();
  const restarted = await start(t, dir);
  assert.equal((await restarted.request("/api/history"))[0].meals.find((item) => item.listMealId === mainId).sides[0].calories, 200);
});

test("a failed pre-upgrade backup prevents schema changes", async (t) => {
  const dir = await workspace(t);
  const db = new DatabaseSync(path.join(dir, "meals.db"));
  db.exec("CREATE TABLE meals (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO meals VALUES (1, 'Keep this');");
  db.close();
  await writeFile(path.join(dir, "backups"), "This file blocks creation of the backup directory.");
  await assert.rejects(() => start(t, dir), /Server exited/);
  const saved = new DatabaseSync(path.join(dir, "meals.db"));
  assert.equal(saved.prepare("SELECT name FROM meals").get().name, "Keep this");
  assert.equal(saved.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('sides', 'list_meal_sides', 'meal_lists')").get().n, 0);
  saved.close();
});

test("combined per-serving calories use each item's own serving count and round the sum once", async (t) => {
  const dir = await workspace(t);
  const app = await start(t, dir);
  const meal = await app.request("/api/meals", "POST", { name: "Main", calories: 1, servings: 3 }, 201);
  const side = await app.request("/api/sides", "POST", { name: "Side", calories: 1, servings: 3 }, 201);
  let list = await app.request("/api/list/meals", "POST", { mealId: meal.id }, 201);
  const endpoint = `/api/list/meals/${list.meals[0].listMealId}/sides`;
  list = await app.request(endpoint, "POST", { sideId: side.id }, 201);
  assert.equal(list.meals[0].totalCaloriesPerServing, 0.7);
  const noCount = await app.request("/api/sides", "POST", { name: "No serving count", calories: 40 }, 201);
  list = await app.request(endpoint, "POST", { sideId: noCount.id }, 201);
  assert.equal(list.meals[0].totalCaloriesPerServing, 40.7);
  const fractional = await app.request("/api/sides", "POST", { name: "Half serving batch", calories: 10, servings: 0.5 }, 201);
  list = await app.request(endpoint, "POST", { sideId: fractional.id }, 201);
  assert.equal(list.meals[0].totalCaloriesPerServing, 60.7);
  const unknown = await app.request("/api/sides", "POST", { name: "Calories unknown" }, 201);
  list = await app.request(endpoint, "POST", { sideId: unknown.id }, 201);
  assert.equal(list.meals[0].totalCaloriesPerServing, 60.7);
  assert.equal(list.meals[0].caloriesIncomplete, true);
});

test("local sides migrate to shared storage without changing attached snapshots", async (t) => {
  const dir = await workspace(t);
  const app = await start(t, dir);
  const side = await app.request("/api/sides", "POST", { name: "Local side", calories: 0, servings: 2 }, 201);
  const meal = await app.request("/api/meals", "POST", { name: "Local main", calories: 300 }, 201);
  const list = await app.request("/api/list/meals", "POST", { mealId: meal.id }, 201);
  await app.request(`/api/list/meals/${list.meals[0].listMealId}/sides`, "POST", { sideId: side.id }, 201);
  await app.stop();
  const shared = await sharedServer(t);
  const connected = await start(t, dir, shared.url);
  const state = await connected.request("/api/state");
  assert.equal(state.sides[0].id, side.id);
  assert.equal(state.sides[0].calories, 1);
  assert.equal(state.activeList.meals[0].sides[0].calories, 0);
  assert.equal(state.activeList.meals[0].sides[0].caloriesPerServing, 0);
  await connected.request("/api/state");
  assert.equal(shared.writes.filter((food) => food.type === "side").length, 1);
});

test("shared sides sync in both directions and never become meals", async (t) => {
  const dir = await workspace(t);
  const shared = await sharedServer(t);
  shared.foods.set("remote-main", { id: "remote-main", type: "meal", name: "Remote meal", calories: 400 });
  shared.foods.set("remote-side", { id: "remote-side", type: "side", name: "Remote side", calories: 100, serving: "One cup", servings: 2, ingredients: "Rice\nSalt" });
  const app = await start(t, dir, shared.url);
  let state = await app.request("/api/state");
  assert.equal(state.meals.length, 1);
  assert.equal(state.sides.length, 1);
  const remote = state.sides[0];
  const list = await app.request("/api/list/meals", "POST", { mealId: state.meals[0].id }, 201);
  await app.request(`/api/list/meals/${list.meals[0].listMealId}/sides`, "POST", { sideId: remote.id }, 201);
  shared.foods.get("remote-side").type = "restaurant";
  state = await app.request("/api/state");
  assert.equal(state.sides.length, 0);
  assert.equal(state.meals.length, 1);
  assert.equal(state.activeList.meals[0].sides[0].name, "Remote side");
  shared.foods.get("remote-side").type = "side";
  shared.foods.get("remote-side").name = "Changed side";
  state = await app.request("/api/state");
  assert.equal(state.sides[0].id, remote.id);
  assert.equal(state.sides[0].name, "Changed side");
  assert.equal(state.activeList.meals[0].sides[0].name, "Remote side");
  const created = await app.request("/api/sides", "POST", { name: "New side", calories: 0, ingredients: ["Beans"], servingSize: "Half the total" }, 201);
  assert.equal(created.calories, 1);
  assert.equal(shared.foods.get(created.sharedFoodId).type, "side");
  await app.request(`/api/sides/${created.id}`, "PUT", { name: "Edited side", calories: 75 });
  assert.equal(shared.foods.get(created.sharedFoodId).calories, 75);
  await app.request(`/api/sides/${created.id}`, "DELETE", undefined, 204);
  assert.ok(!shared.foods.has(created.sharedFoodId));
  shared.foods.delete("remote-side");
  state = await app.request("/api/state");
  assert.equal(state.sides.length, 0);
  assert.equal(state.activeList.meals[0].sides[0].calories, 100);
});

test("an older shared API cannot silently save a side as a meal", async (t) => {
  const dir = await workspace(t);
  const shared = await sharedServer(t, { old: true });
  const app = await start(t, dir, shared.url);
  await app.request("/api/sides", "POST", { name: "Must remain a side", calories: 50 }, 502);
  assert.equal(shared.writes.length, 0);
  assert.equal((await app.request("/api/state")).sides.length, 0);
});
