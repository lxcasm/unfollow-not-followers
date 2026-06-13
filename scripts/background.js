const ext = globalThis.browser ?? globalThis.chrome;
const EXTENSION_VERSION = "2.3.1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findInstagramTab() {
  const tabs = await ext.tabs.query({});
  const instagramTabs = tabs.filter((tab) =>
    /https?:\/\/(www\.)?instagram\.com/i.test(tab.url || "")
  );

  if (!instagramTabs.length) {
    return null;
  }

  return (
    instagramTabs.find((tab) => tab.active) ||
    instagramTabs.find((tab) => tab.highlighted) ||
    instagramTabs[0]
  );
}

async function ensureContentScript(tabId) {
  try {
    const ping = await ext.tabs.sendMessage(tabId, { type: "PING" });
    if (ping?.ok) {
      return;
    }
  } catch {
    // Injection nécessaire.
  }

  await ext.scripting.executeScript({
    target: { tabId },
    files: ["scripts/content.js"],
  });

  try {
    await ext.scripting.executeScript({
      target: { tabId },
      files: ["scripts/page-bridge.js"],
      world: "MAIN",
    });
  } catch {
    // content.js charge le bridge via balise script si besoin.
  }

  await sleep(500);
}

async function sendToTab(tabId, message) {
  await ensureContentScript(tabId);

  const delays = [0, 400, 800, 1200, 2000];
  let lastError = null;

  for (const waitMs of delays) {
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      const response = await ext.tabs.sendMessage(tabId, message);
      if (response !== undefined) {
        return response;
      }
    } catch (error) {
      lastError = error;
      await ensureContentScript(tabId);
    }
  }

  throw new Error(
    lastError?.message ||
      "Impossible de parler à Instagram. Rafraîchissez instagram.com (F5), puis réessayez."
  );
}

async function handleSendToInstagram(payload) {
  const tab = await findInstagramTab();

  if (!tab?.id) {
    return {
      ok: false,
      error:
        "Ouvrez instagram.com dans un onglet Firefox, connectez-vous, puis réessayez.",
    };
  }

  try {
    return await sendToTab(tab.id, payload);
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING_BACKGROUND") {
    sendResponse({ ok: true, version: EXTENSION_VERSION });
    return false;
  }

  if (message.type === "SEND_TO_INSTAGRAM") {
    handleSendToInstagram(message.payload)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: error.message || String(error) })
      );
    return true;
  }

  return false;
});
