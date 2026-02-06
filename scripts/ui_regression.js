#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const { chromium, devices } = require('playwright');

const SERVER_PORT = 3011;
const CLIENT_PORT = 4173;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1200, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
        return;
      }
      setTimeout(probe, 250);
    };

    probe();
  });
}

function startProcess(cmd, args, opts) {
  const proc = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });

  proc.stdout.on('data', (chunk) => {
    process.stdout.write(chunk.toString());
  });
  proc.stderr.on('data', (chunk) => {
    process.stderr.write(chunk.toString());
  });

  return proc;
}

function killProcess(proc) {
  if (!proc || proc.killed) return;
  proc.kill('SIGTERM');
}

async function waitForBattle(page, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hasConfirm = await page.getByRole('button', { name: 'Confirm' }).isVisible().catch(() => false);
    const hasPrepText = await page.getByText('Подготовка боя…').isVisible().catch(() => false);
    if (hasConfirm || hasPrepText) return;
    await page.waitForTimeout(150);
  }
  throw new Error('Battle screen did not appear in time');
}

async function assertNoOverflow(page, profileName) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      htmlW: root.scrollWidth,
      htmlH: root.scrollHeight,
      bodyW: body.scrollWidth,
      bodyH: body.scrollHeight,
    };
  });

  if (result.htmlW > result.innerW + 1 || result.bodyW > result.innerW + 1) {
    throw new Error(`[${profileName}] horizontal overflow detected: ${JSON.stringify(result)}`);
  }
}

async function runProfile(browser, profile) {
  const context = await browser.newContext(profile.context);
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => {
    consoleErrors.push(String(e));
  });

  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /Create account/i }).click();
  await page.waitForTimeout(1200);

  const nicknameField = page.getByPlaceholder(/Enter your nickname/i);
  if (await nicknameField.isVisible().catch(() => false)) {
    await nicknameField.fill(`ux${Date.now().toString().slice(-6)}`);
    await page.getByRole('button', { name: /Save & Continue/i }).click();
    await page.waitForTimeout(1200);
  }

  await page.getByRole('button', { name: /Start PvE Training/i }).waitFor({ timeout: 12000 });
  await assertNoOverflow(page, profile.name);
  await page.getByRole('button', { name: /Start PvE Training/i }).click();

  await waitForBattle(page);
  await page.getByRole('button', { name: 'Confirm' }).waitFor({ timeout: 12000 });
  await assertNoOverflow(page, profile.name);

  if (consoleErrors.length > 0) {
    throw new Error(`[${profile.name}] console errors: ${consoleErrors.join(' | ')}`);
  }

  await context.close();
}

async function main() {
  const server = startProcess('node', ['index.js'], {
    cwd: 'server',
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      TEST_MODE: '1',
      TEST_PREP_MS: '400',
      TEST_STEP_MS: '70',
    },
  });

  const client = startProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(CLIENT_PORT)], {
    cwd: 'client',
    env: {
      ...process.env,
      VITE_API_BASE: `http://127.0.0.1:${SERVER_PORT}`,
      VITE_SOCKET_URL: `http://127.0.0.1:${SERVER_PORT}`,
    },
  });

  try {
    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`);
    await waitForHttp(CLIENT_URL);

    const browser = await chromium.launch({ headless: true });
    try {
      const profiles = [
        { name: 'iphone-se', context: { ...devices['iPhone SE'] } },
        { name: 'pixel-7', context: { ...devices['Pixel 7'] } },
        { name: 'ipad-mini', context: { ...devices['iPad Mini'] } },
        { name: 'desktop-1366', context: { viewport: { width: 1366, height: 768 } } },
      ];

      for (const profile of profiles) {
        process.stdout.write(`\n[ui-regression] running ${profile.name}\n`);
        await runProfile(browser, profile);
      }
    } finally {
      await browser.close();
    }

    process.stdout.write('\n[ui-regression] all profiles passed\n');
  } finally {
    killProcess(client);
    killProcess(server);
    await delay(400);
  }
}

main().catch((err) => {
  console.error('[ui-regression] FAILED:', err.message);
  process.exit(1);
});
