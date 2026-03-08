# 9Router Cloud Worker

Deploy your own Cloudflare Worker to access 9Router from anywhere.

## One-command deployment

You no longer need to run `wrangler login`, manually create D1, or paste IDs into `wrangler.toml`.

The deployment script now only requires these two variables:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

During deployment it will:

1. Reuse an existing D1 database by name, or create one automatically.
2. Run the SQL migration in `migrations/0001_init.sql`.
3. Generate a temporary Wrangler config with the correct D1 binding.
4. Deploy the Worker with Wrangler.

## Setup

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

> The API token must be allowed to deploy Workers and manage D1 resources for the target account.

### 3. Deploy

```bash
npm run deploy
```

Optional overrides:

```env
# Default: 9router
CLOUDFLARE_WORKER_NAME=9router

# Default: <worker-name>-db
CLOUDFLARE_D1_NAME=9router-db
```

After deployment, Wrangler will print the Worker URL.

Copy that URL → 9Router Dashboard → **Endpoint** → **Setup Cloud** → paste → **Save** → **Enable Cloud**.
