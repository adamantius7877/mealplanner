# Meals and Grocery Dashboard

Meals and Grocery Dashboard is a small self-hosted web app for keeping a reusable meal library, choosing meals for the current planning period, and turning those planned meals into a grocery list.

It is designed to run in Docker on another machine. Meal lists and list history are stored in a SQLite database inside a Docker volume, so app redeploys and rebuilds do not erase your planning history. The reusable meal library can be shared with CaloriesDashboard through its shared food API.

## Features

- Add meals with a required name.
- Share the reusable meal library with CaloriesDashboard.
- Create, edit, and remove shared sides with their own calories, servings, serving size, and ingredients.
- Attach or remove sides on an individual meal in the current list, including meals marked Had.
- See individual meal/side calorie details and a combined total without selecting portions.
- Optionally add ingredients, total calories, number of servings, and a text serving size such as "one cup" or "half the total."
- See calories for the whole meal and calculated calories per serving.
- Edit or remove meals from the main meal library.
- Import base meals from a CSV file.
- Add meals from the meal library to the current "Meals to Have" list.
- Mark meals as had/done for the current period without deleting them from the main meal library.
- See meals marked as had for the current period and move them back to "Meals to Have."
- Collapse and expand the meal, grocery, history, and library lists.
- Start the next list, keeping unfinished meals and their attached sides in both the previous and next lists.
- Automatically records list start and end dates.
- View previous lists and the time periods they covered.
- Remove previous lists without deleting meals from the main meal library.
- See an aggregated grocery list from ingredients on planned meals.
- Copy the current grocery list for shopping.

## Project Structure

```text
.
|-- Dockerfile
|-- docker-compose.yml
|-- deploy.ps1
|-- deploy.sh
|-- .env.example
|-- package.json
|-- public
|   |-- app.js
|   |-- index.html
|   `-- styles.css
`-- src
    `-- server.js
```

## Requirements

On the machine that will host the app:

- Docker
- Docker Compose

The PowerShell deploy script supports both modern `docker compose` and older `docker-compose`.

## First Deploy

Copy this project folder to the machine where you want to host it.

From inside the project folder, run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\deploy.ps1
```

The deploy script creates `.env` from `.env.example` if `.env` does not exist.

Open the app:

```text
http://localhost:3002
```

From another device on the same network, use the host machine's IP address:

```text
http://SERVER_IP:3002
```

For example:

```text
http://192.168.1.25:3002
```

## Redeploy After Changes

When app files change, copy or pull the updated project folder onto the host machine, then run:

```powershell
.\deploy.ps1
```

The script rebuilds the application image and restarts the container. It does not delete the database volume, so your meals, active list, and previous lists remain intact.

## Shared Meal Library With CaloriesDashboard

Mealplanner can use CaloriesDashboard as the shared database for meals only. Active lists, had/not-had status, previous lists, and grocery-list history still stay in Mealplanner's existing SQLite database.

Configure the shared meal server in `.env`:

```text
SHARED_FOOD_SERVER=host.docker.internal
SHARED_FOOD_PORT=3000
```

Use `host.docker.internal` when CaloriesDashboard is running in Docker on the same Windows host and is exposed on port `3000`. If CaloriesDashboard is running on another machine, use that machine's server name or IP address:

```text
SHARED_FOOD_SERVER=192.168.1.25
SHARED_FOOD_PORT=3000
```

On startup, Mealplanner migrates existing local meals to CaloriesDashboard's shared food API using stable IDs like `mealplanner-12`. Meals that had blank or `0` calories are sent as `1` calorie so the shared API accepts them.

After migration:

- The All meals library is read from the shared food library.
- Adding, editing, importing, or removing meals writes to the shared food library.
- Existing current and previous lists keep working because Mealplanner preserves local meal references for list history.

## Sides

Use **All sides** to manage reusable sides. Choose **Side** in the add/edit form to save one. Meals and sides have separate libraries, and both are shared with CaloriesDashboard. Existing meals remain meals after the upgrade.

After adding a meal to the current list, choose a side on that meal and select **Add side**. Each side can be attached once to each planned meal. The same side can be used on multiple meals. **Remove side** removes only that attachment, while **Remove** in All sides deletes the shared library item.

Each attachment records the side's name, total calories, number of servings, text serving size, and ingredients at the time it is attached. Editing or deleting the side in either app does not change existing attachments. Remove and re-add a side to use its latest details on a current meal. Previous lists are read-only for side attachments.

The combined calorie total adds the meal's total calories and each attached side's total calories. Serving counts and calories per serving are displayed individually; no portion multiplier is applied. If local-only entries have missing calories, the summary labels the sum as known calories. Shared entries with blank or zero calories continue to use the 1-calorie fallback.

Side ingredients are included in groceries while the meal is planned, disappear when the meal is marked Had, and return if it is unmarked. Attached sides carry forward unchanged with unfinished meals when starting the next list. Previous lists retain their own copies.

### Upgrade Order And Backups

1. Update and deploy CaloriesDashboard first. Its additive `004_food_sides.sql` migration permits `type=side`, and its deployment script backs up an existing running PostgreSQL database before rebuilding.
2. Update and deploy Mealplanner with `git pull` and `.\deploy.ps1`. The host port remains `3002`, and the existing `meals-data` volume is reused.
3. Refresh Mealplanner. Meals stay in All meals; shared sides appear in All sides.

Mealplanner checks the shared API's advertised Side support before uploading a side. If the CaloriesDashboard update has not been deployed, it reports an error before posting instead of accidentally saving a side as a meal.

Before the first sides schema upgrade on an existing Mealplanner database, the app automatically saves a consistent SQLite backup (including committed WAL data) under `/data/backups/before-sides-TIMESTAMP.db`. A failed backup stops startup before schema changes. The upgrade only creates the `sides` and `list_meal_sides` tables; it does not replace or clear meals, lists, or list entries. Subsequent restarts reuse these tables and do not repeat the backup.

Copy these backups to the host after deployment:

```powershell
docker cp meals-and-grocery-dashboard:/data/backups ./backups
```

Keep both Mealplanner SQLite backups and CaloriesDashboard PostgreSQL backups: the shared food library is stored in PostgreSQL, while attachment snapshots and lists are stored in SQLite. Normal redeploys do not remove either volume.

## Data Persistence

The app stores list and history data at this path inside the container:

```text
/data/meals.db
```

That path is backed by the Docker volume named:

```text
meals-data
```

The relevant part of `docker-compose.yml` is:

```yaml
volumes:
  - meals-data:/data
```

This means normal redeploys, restarts, and rebuilds preserve list and history data.

Important: do not remove the `meals-data` Docker volume unless you intentionally want to delete Mealplanner list and history data. Shared meal-library data lives in the CaloriesDashboard PostgreSQL database.

## Backup Data

To back up the database, run this on the host machine:

```sh
docker run --rm -v meals-data:/data -v "$PWD":/backup alpine cp /data/meals.db /backup/meals-backup.db
```

You can confirm the volume exists with:

```sh
docker volume ls
```

## Restore Data

Stop the app:

```sh
docker compose down
```

Copy a backup database into the volume:

```sh
docker run --rm -v meals-data:/data -v "$PWD":/backup alpine cp /backup/meals-backup.db /data/meals.db
```

Start the app again:

```powershell
.\deploy.ps1
```

## CSV Import

Use the import control in the app. Supported CSV headers:

- `name` required
- `ingredients` optional
- `calories` or `total_calories` optional
- `servings`, `serving_count`, or `number_of_servings` optional
- `serving_size`, `serving_description`, or `serving_size_text` optional

Ingredients can be separated by semicolons, commas, or new lines.

You can also import a headerless CSV that is just a list of meal names. Each cell will be imported as one meal.

Example:

```csv
name,ingredients,calories,servings,serving_size
Chicken Tacos,"chicken; tortillas; lettuce; salsa",720,4,two tacos
Lentil Soup,"lentils; carrots; onion; broth",980,6,one bowl
```

## Change the Port

The app listens on port `3000` inside Docker and is exposed as port `3002` on the host by default. To expose it on a different host port, edit `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"
```

Then redeploy:

```powershell
.\deploy.ps1
```

The app would then be available at:

```text
http://SERVER_IP:8080
```

## Useful Commands

Start or redeploy:

```powershell
.\deploy.ps1
```

Stop the app without deleting data:

```sh
docker compose down
```

View logs:

```sh
docker compose logs -f
```

Restart:

```sh
docker compose restart
```

Linux or macOS hosts can use `./deploy.sh` instead of `.\deploy.ps1`.

## Local Development

If you want to run the app outside Docker:

```sh
npm run dev
```

Open:

```text
http://localhost:3000
```

By default, local development stores the database at:

```text
data/meals.db
```

## Notes

- This app does not require user accounts.
- This app is intended for private home or personal network use.
- If exposing it publicly, place it behind a reverse proxy with HTTPS and access control.
