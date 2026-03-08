import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLOUD_DIR = path.resolve(__dirname, "..");
const BASE_CONFIG_PATH = path.join(CLOUD_DIR, "wrangler.toml");
const GENERATED_CONFIG_PATH = path.join(CLOUD_DIR, ".wrangler", "deploy", "wrangler.generated.toml");
const MIGRATION_PATH = path.join(CLOUD_DIR, "migrations", "0001_init.sql");
const ENV_FILE_PATH = path.join(CLOUD_DIR, ".env");
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

const HELP_TEXT = `9Router Cloud deploy helper

Required environment variables:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID

Optional environment variables:
  CLOUDFLARE_WORKER_NAME   Worker name to deploy (default: 9router)
  CLOUDFLARE_D1_NAME       D1 database name (default: <worker-name>-db)

Usage:
  npm run deploy
  npm run deploy:help
`;

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) return null;

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!key) return null;

  let value = trimmed.slice(separatorIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

async function loadDotEnvFile() {
  const envFileExists = await readFile(ENV_FILE_PATH, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (!envFileExists) {
    return;
  }

  for (const line of envFileExists.split(/\r?\n/)) {
    const parsedLine = parseEnvLine(line);
    if (!parsedLine) continue;

    if (!process.env[parsedLine.key]) {
      process.env[parsedLine.key] = parsedLine.value;
    }
  }
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name, fallbackValue) {
  const value = process.env[name]?.trim();
  return value || fallbackValue;
}

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;

function isLikelyAccountId(value) {
  return ACCOUNT_ID_PATTERN.test(value || "");
}

function formatAccessibleAccounts(accounts) {
  return accounts
    .map((account) => `- ${account.name} (${account.id})`)
    .join("\n");
}

async function tryListAccessibleAccounts(token) {
  try {
    const memberships = await callCloudflareApi("/memberships?per_page=100", {
      token
    });

    return memberships
      .map((membership) => membership?.account)
      .filter((account) => account?.id && account?.name);
  } catch {
    return [];
  }
}

async function callCloudflareApi(apiPath, { method = "GET", body, token }) {
  const response = await fetch(`${CLOUDFLARE_API_BASE}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const apiErrors = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => item?.message).filter(Boolean).join("; ")
      : "";
    const fallbackMessage = `Cloudflare API request failed: ${response.status} ${response.statusText}`;
    throw new Error(apiErrors || fallbackMessage);
  }

  return payload.result;
}

async function findD1DatabaseByName(accountId, token, databaseName) {
  const query = new URLSearchParams({
    name: databaseName,
    per_page: "100"
  });

  const result = await callCloudflareApi(`/accounts/${accountId}/d1/database?${query.toString()}`, {
    token
  });

  return result.find((database) => database.name === databaseName) || null;
}

async function createD1Database(accountId, token, databaseName) {
  return callCloudflareApi(`/accounts/${accountId}/d1/database`, {
    method: "POST",
    token,
    body: {
      name: databaseName
    }
  });
}

async function ensureD1Database(accountId, token, databaseName) {
  const existingDatabase = await findD1DatabaseByName(accountId, token, databaseName);
  if (existingDatabase) {
    console.log(`→ Reusing D1 database: ${existingDatabase.name} (${existingDatabase.uuid})`);
    return existingDatabase;
  }

  console.log(`→ Creating D1 database: ${databaseName}`);
  const createdDatabase = await createD1Database(accountId, token, databaseName);
  console.log(`→ Created D1 database: ${createdDatabase.name} (${createdDatabase.uuid})`);
  return createdDatabase;
}

async function generateWranglerConfig(databaseName, databaseId) {
  const baseConfig = await readFile(BASE_CONFIG_PATH, "utf8");
  const generatedConfig = `${baseConfig.trim()}

# Generated by scripts/deploy.mjs
[[d1_databases]]
binding = "DB"
database_name = "${databaseName}"
database_id = "${databaseId}"
`;

  await mkdir(path.dirname(GENERATED_CONFIG_PATH), { recursive: true });
  await writeFile(GENERATED_CONFIG_PATH, generatedConfig, "utf8");

  return GENERATED_CONFIG_PATH;
}

async function runCommand(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function runWrangler(args) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  await runCommand(npxCommand, ["wrangler", ...args], CLOUD_DIR);
}

async function enrichAccountIdError(error, accountId, token) {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const looksLikeInvalidAccount =
    originalMessage.includes("/client/v4/accounts/") ||
    /object identifier is invalid/i.test(originalMessage) ||
    /could not route/i.test(originalMessage);

  if (!looksLikeInvalidAccount) {
    return error instanceof Error ? error : new Error(originalMessage);
  }

  const messageParts = [
    originalMessage,
    "",
    "CLOUDFLARE_ACCOUNT_ID 很可能填写错了。它必须是 Cloudflare Account ID，而不是 Zone ID、邮箱、用户名或别的资源 ID。"
  ];

  if (!isLikelyAccountId(accountId)) {
    messageParts.push(`当前值 \"${accountId}\" 不是典型的 32 位十六进制 Account ID。`);
  }

  const accessibleAccounts = await tryListAccessibleAccounts(token);
  if (accessibleAccounts.length > 0) {
    messageParts.push(
      "",
      "当前 API Token 可访问的 Cloudflare 账户如下：",
      formatAccessibleAccounts(accessibleAccounts),
      "",
      "请把正确的 account.id 填到 GitHub Secret `CLOUDFLARE_ACCOUNT_ID`。"
    );
  } else {
    messageParts.push(
      "",
      "如果当前 Token 没有 Memberships Read 权限，脚本无法自动列出账号。",
      "请到 Cloudflare Dashboard 查看右侧栏的 Account ID，或从浏览器地址栏 `https://dash.cloudflare.com/<ACCOUNT_ID>/...` 中复制。"
    );
  }

  return new Error(messageParts.join("\n"));
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }

  await loadDotEnvFile();

  const apiToken = getRequiredEnv("CLOUDFLARE_API_TOKEN");
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const workerName = getOptionalEnv("CLOUDFLARE_WORKER_NAME", "9router");
  const databaseName = getOptionalEnv("CLOUDFLARE_D1_NAME", `${workerName}-db`);

  console.log(`→ Using worker name: ${workerName}`);
  console.log(`→ Using Cloudflare account: ${accountId}`);
  console.log(`→ Environment file: ${path.relative(CLOUD_DIR, ENV_FILE_PATH)}`);

  if (!isLikelyAccountId(accountId)) {
    console.warn("⚠️ CLOUDFLARE_ACCOUNT_ID does not look like a 32-character Cloudflare account id.");
  }

  try {
    const database = await ensureD1Database(accountId, apiToken, databaseName);
    const configPath = await generateWranglerConfig(database.name, database.uuid);

    console.log(`→ Generated Wrangler config: ${path.relative(CLOUD_DIR, configPath)}`);
    console.log(`→ Applying migration: ${path.relative(CLOUD_DIR, MIGRATION_PATH)}`);
    await runWrangler(["d1", "execute", database.name, "--remote", `--file=${MIGRATION_PATH}`, "--config", configPath]);

    console.log("→ Deploying Worker...");
    await runWrangler(["deploy", "--name", workerName, "--config", configPath]);

    console.log("✅ Cloudflare Worker deployment completed.");
    console.log("Next step: copy the workers.dev URL printed by Wrangler into 9Router Dashboard → Endpoint → Setup Cloud.");
  } catch (error) {
    throw await enrichAccountIdError(error, accountId, apiToken);
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
