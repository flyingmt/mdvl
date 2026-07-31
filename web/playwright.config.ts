import { defineConfig, devices } from '@playwright/test';

// Every test starts its own daemon on its own port, so there is no shared server
// to boot here — only a browser. The locale is pinned so the assertions read in
// one language; the Korean case sets its own.
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	reporter: 'list',
	use: { ...devices['Desktop Chrome'], locale: 'en-US' }
});
