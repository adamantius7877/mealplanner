# Meals and Grocery Dashboard

Meals and Grocery Dashboard is a small self-hosted web app for keeping a reusable meal library, choosing meals for the current planning period, and turning those planned meals into a grocery list.

It is designed to run in Docker on another machine. Data is stored in a SQLite database inside a Docker volume, so app redeploys and rebuilds do not erase your meals or list history.

## Features

- Add meals with a required name.
- Optionally add ingredients, total calories, number of servings, and a text serving size such as "one cup" or "half the total."
- See calories for the whole meal and calculated calories per serving.
- Edit or remove meals from the main meal library.
- Import base meals from a CSV file.
- Add meals from the meal library to the current "Meals to Have" list.
- Mark meals as had/done for the current period without deleting them from the main meal library.
- Start the next list, which closes the current list and creates a fresh active list.
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

## Data Persistence

The app stores its database at this path inside the container:

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

This means normal redeploys, restarts, and rebuilds preserve the database.

Important: do not remove the `meals-data` Docker volume unless you intentionally want to delete all app data.

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
