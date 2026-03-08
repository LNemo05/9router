# 9Router Cloud Worker

Deploy your own Cloudflare Worker to access 9Router from anywhere.

## Recommended: deploy from GitHub Actions

If your code is already on GitHub, you no longer need to run deployment locally.

This repository now includes:

- `.github/workflows/cloudflare-workers.yml`
- `cloud/scripts/deploy.mjs`

Together they provide a grok2api-style deployment flow:

1. GitHub Actions reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from repository secrets.
2. The deploy helper automatically reuses or creates the D1 database.
3. It runs `migrations/0001_init.sql` remotely.
4. It generates a temporary Wrangler config with the correct D1 binding.
5. It deploys the Worker to Cloudflare.

> 9Router's Cloudflare worker currently uses **D1 only**. Unlike some other projects, you do not need to create or bind KV for this deployment flow.

## GitHub setup

### 1. Push this repository to GitHub

Use your own repository or fork as the source of truth.

### 2. Add GitHub Actions secrets

Open:

`Settings` → `Secrets and variables` → `Actions`

Create these **repository secrets**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Your API token should have permission to:

- deploy Workers
- create/read/write D1 resources

### 3. Optional repository variables

You can also add these **repository variables** if you want custom names:

- `CLOUDFLARE_WORKER_NAME`
- `CLOUDFLARE_D1_NAME`

Defaults:

```text
CLOUDFLARE_WORKER_NAME = 9router
CLOUDFLARE_D1_NAME = 9router-db
```

### 4. Trigger deployment

The workflow will deploy automatically when you push to the `master` branch.

You can also trigger it manually from:

`GitHub` → `Actions` → `Deploy 9Router Cloud Worker` → `Run workflow`

## What the workflow actually does

The GitHub Actions workflow runs inside the `cloud` directory and executes:

```bash
npm install
npm run deploy
```

The deploy helper handles all Cloudflare bootstrap work automatically, so you do **not** need to:

- run `wrangler login`
- manually create D1
- manually copy `database_id`
- edit `wrangler.toml` before each deployment

## Manual local deployment (optional fallback)

If you still want to deploy manually from your machine, that path remains available.

### 1. Install dependencies

```bash
cd cloud
npm install
```

### 2. Prepare environment variables

Create a `.env` file from the example in the `cloud` directory.

**PowerShell**

```powershell
Copy-Item .env.example .env
```

**bash**

```bash
cp .env.example .env
```

Then fill in:

```env
CLOUDFLARE_API_TOKEN=your-token
CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Optional overrides:

```env
# Default: 9router
CLOUDFLARE_WORKER_NAME=9router

# Default: <worker-name>-db
CLOUDFLARE_D1_NAME=9router-db
```

### 3. Deploy

```bash
npm run deploy
```

## After deployment

After the workflow or manual deploy completes, Wrangler prints the Worker URL.

Copy that URL → 9Router Dashboard → **Endpoint** → **Setup Cloud** → paste → **Save** → **Enable Cloud**.
