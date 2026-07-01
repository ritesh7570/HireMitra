import { Router } from 'express';
import { getCredentials, setCredentials, deleteCredentials, listPlatforms } from '../services/credentialStore.js';
import { getSessionMeta, isSessionFresh, saveSession } from '../services/sessionManager.js';
import { createBrowserPage } from '../scrapers/utils.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const platforms = await listPlatforms();
    const withSessions = await Promise.all(
      platforms.map(async (platform) => ({
        ...platform,
        session: await getSessionMeta(platform.platform),
        sessionFresh: await isSessionFresh(platform.platform)
      }))
    );
    res.json({ platforms: withSessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:platform', async (req, res) => {
  try {
    const updated = await setCredentials(req.params.platform, {
      email: req.body.email,
      password: req.body.password,
      enabled: req.body.enabled
    });
    res.json({ platform: req.params.platform, email: updated.email, enabled: updated.enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:platform', async (req, res) => {
  try {
    await deleteCredentials(req.params.platform);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Spawns a HEADED browser (not headless) so the user can visually confirm the login and
// handle any captcha themselves — never solved automatically, per the non-negotiable
// rule. Only works once the named platform's applicator exists and exports a login()
// function (Phase 3 steps 6-7) — until then this cleanly reports 501, it doesn't pretend
// to attempt anything.
router.post('/:platform/test-login', async (req, res) => {
  const { platform } = req.params;
  try {
    const credentials = await getCredentials(platform);
    if (!credentials || !credentials.email || !credentials.password) {
      return res.status(400).json({ error: `No email/password configured for "${platform}" yet.` });
    }

    let applicatorModule;
    try {
      applicatorModule = await import(`../applicators/${platform}.js`);
    } catch {
      return res.status(501).json({
        error: `No applicator exists yet for "${platform}" — nothing to test login against.`
      });
    }
    if (typeof applicatorModule.login !== 'function') {
      return res.status(501).json({
        error: `The "${platform}" applicator doesn't export a login() function yet.`
      });
    }

    const { browser, page } = await createBrowserPage({ headless: false });
    try {
      // test-login is always a deliberate human action — bypass the 6h throttle
      // (which is for automated pipeline logins only) and call loginFn directly.
      const cookies = await applicatorModule.login(page, credentials);
      await saveSession(platform, cookies);
      res.json({ success: true, message: 'Login succeeded — session saved.' });
    } catch (error) {
      res.json({ success: false, message: error.message });
    } finally {
      await browser.close();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
