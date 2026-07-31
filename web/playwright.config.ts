import { defineConfig, devices } from '@playwright/test';

// Every test starts its own daemon on its own port, so there is no shared server
// to boot here — only a browser.
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	reporter: 'list',
	use: { ...devices['Desktop Chrome'] }
});
