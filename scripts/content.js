const CONTENT_SOURCE = "unfollow-not-followers-content";
const PAGE_SOURCE = "unfollow-not-followers-page";
const BRIDGE_READY_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const ext = globalThis.browser ?? globalThis.chrome;

const state = globalThis.__unfollowContentState ?? {
  pendingRequests: new Map(),
  bridgePromise: null,
  listenersReady: false,
};
globalThis.__unfollowContentState = state;

function postToPage(data) {
  window.postMessage({ source: CONTENT_SOURCE, ...data }, "*");
}

async function readInstagramCookies() {
  const cookiesApi = ext?.cookies;
  if (!cookiesApi?.get) {
    return { csrfToken: null, userId: null };
  }

  const values = {};
  for (const name of ["csrftoken", "ds_user_id"]) {
    try {
      const cookie = await cookiesApi.get({
        url: "https://www.instagram.com/",
        name,
      });
      if (cookie?.value) {
        values[name] = cookie.value;
      }
    } catch {
      // Le script page récupère les cookies HttpOnly si besoin.
    }
  }

  return {
    csrfToken: values.csrftoken || null,
    userId: values.ds_user_id || null,
  };
}

function ensureBridge() {
  if (document.documentElement.dataset.unfollowBridgeReady === "1") {
    return Promise.resolve();
  }

  if (globalThis.__unfollowNotFollowersBridge) {
    document.documentElement.dataset.unfollowBridgeReady = "1";
    return Promise.resolve();
  }

  if (state.bridgePromise) {
    return state.bridgePromise;
  }

  state.bridgePromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      window.removeEventListener("message", onReadyListener);
      state.bridgePromise = null;
      reject(
        new Error(
          "Impossible de joindre Instagram. Rafraîchissez la page (F5) et réessayez."
        )
      );
    }, BRIDGE_READY_TIMEOUT_MS);

    function onReadyListener(event) {
      if (event.source !== window || event.data?.source !== PAGE_SOURCE) {
        return;
      }
      if (event.data.type !== "ready") {
        return;
      }

      clearTimeout(timeoutId);
      window.removeEventListener("message", onReadyListener);
      document.documentElement.dataset.unfollowBridgeReady = "1";
      resolve();
    }

    window.addEventListener("message", onReadyListener);

    const script = document.createElement("script");
    script.src = ext.runtime.getURL("scripts/page-bridge.js");
    script.onload = () => script.remove();
    script.onerror = () => {
      clearTimeout(timeoutId);
      window.removeEventListener("message", onReadyListener);
      state.bridgePromise = null;
      reject(new Error("Impossible de charger le module Instagram."));
    };

    (document.head || document.documentElement).appendChild(script);
  });

  return state.bridgePromise;
}

function onPageMessage(event) {
  if (event.source !== window || event.data?.source !== PAGE_SOURCE) {
    return;
  }

  const data = event.data;

  if (data.type === "ready") {
    document.documentElement.dataset.unfollowBridgeReady = "1";
    return;
  }

  if (data.progress) {
    ext.runtime
      .sendMessage({
        type: "EXTENSION_PROGRESS",
        progress: data.progressData,
      })
      .catch(() => {});
    return;
  }

  const handler = state.pendingRequests.get(data.requestId);
  if (!handler) {
    return;
  }

  state.pendingRequests.delete(data.requestId);
  handler(data);
}

async function fetchAvatarDataUrl(url) {
  if (!url) {
    throw new Error("Photo de profil introuvable.");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Impossible de charger la photo de profil.");
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
    reader.readAsDataURL(blob);
  });
}

function callBridge(action, payload = {}) {
  return readInstagramCookies().then((sessionCookies) =>
    ensureBridge().then(
      () =>
        new Promise((resolve, reject) => {
          const requestId = crypto.randomUUID();
          const timeoutId = setTimeout(() => {
            state.pendingRequests.delete(requestId);
            reject(
              new Error(
                "L'analyse a pris trop de temps. Rafraîchissez Instagram (F5) et réessayez."
              )
            );
          }, REQUEST_TIMEOUT_MS);

          state.pendingRequests.set(requestId, (detail) => {
            clearTimeout(timeoutId);
            if (detail.ok) {
              resolve(detail.result);
              return;
            }
            reject(new Error(detail.error || "Erreur inconnue."));
          });

          postToPage({
            requestId,
            action,
            payload: { ...payload, sessionCookies },
          });
        })
    )
  );
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (message.type === "PING") {
    sendResponse({ ok: true, ready: true });
    return false;
  }

  const respond = (promise) => {
    promise
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error.message || String(error) })
      );
    return true;
  };

  if (message.type === "GET_AVATAR") {
    return respond(fetchAvatarDataUrl(message.url).then((dataUrl) => ({ dataUrl })));
  }

  if (message.type === "GET_PROFILE") {
    return respond(callBridge("profile"));
  }

  if (message.type === "ANALYZE") {
    return respond(callBridge("analyze", { batchSize: message.batchSize }));
  }

  if (message.type === "UNFOLLOW") {
    return respond(
      callBridge("unfollow", {
        users: message.users,
        delayMs: message.delayMs,
      })
    );
  }

  return false;
}

if (!state.listenersReady) {
  state.listenersReady = true;
  window.addEventListener("message", onPageMessage);
  ext.runtime.onMessage.addListener(handleRuntimeMessage);
}
