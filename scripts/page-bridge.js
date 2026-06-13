(() => {
  const CONTENT_SOURCE = "unfollow-not-followers-content";
  const PAGE_SOURCE = "unfollow-not-followers-page";

  function postToContent(data) {
    window.postMessage({ source: PAGE_SOURCE, ...data }, "*");
  }

  if (window.__unfollowNotFollowersBridge) {
    postToContent({ type: "ready" });
    return;
  }
  window.__unfollowNotFollowersBridge = true;

  const API_BASE = "https://www.instagram.com/api/v1";
  const IG_APP_ID = "936619743392459";
  const PAGE_SIZE = 50;
  const REQUEST_DELAY_MS = 350;
  const DEFAULT_BATCH_SIZE = 15;

  const GRAPHQL_DOCS = {
    followers: "8048870218534893",
    following: "8067006740098098",
  };

  const GRAPHQL_EDGES = {
    followers: "edge_followed_by",
    following: "edge_follow",
  };

  let analysisState = null;
  let useGraphql = false;

  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getCsrfToken() {
    return getCookie("csrftoken");
  }

  function getSession(override = {}) {
    const csrfToken = override.csrfToken || getCsrfToken();
    const userId = override.userId || getCookie("ds_user_id");

    if (!csrfToken) {
      throw new Error(
        "Session Instagram introuvable. Restez sur instagram.com, reconnectez-vous si besoin, puis appuyez sur F5."
      );
    }

    let wwwClaim = "0";
    try {
      wwwClaim =
        sessionStorage.getItem("www-claim-v2") ||
        localStorage.getItem("www-claim-v2") ||
        "0";
    } catch {
      wwwClaim = "0";
    }

    return { csrfToken, userId, wwwClaim };
  }

  function buildHeaders(session) {
    return {
      Accept: "*/*",
      "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      "X-CSRFToken": session.csrfToken,
      "X-IG-App-ID": IG_APP_ID,
      "X-IG-WWW-Claim": session.wwwClaim,
      "X-Requested-With": "XMLHttpRequest",
      "X-ASBD-ID": "129477",
      "X-Instagram-AJAX": "1019899179",
      Referer: "https://www.instagram.com/",
      Origin: "https://www.instagram.com",
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function readError(response) {
    try {
      const text = await response.text();
      if (!text) {
        return "";
      }
      const json = JSON.parse(text);
      return json.message || json.error_type || text.slice(0, 160);
    } catch {
      return "";
    }
  }

  async function fetchInstagram(path, session, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...buildHeaders(session),
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const details = await readError(response);
      throw new Error(
        `Erreur Instagram (${response.status})${details ? `: ${details}` : ""}`
      );
    }

    return response.json();
  }

function extractAvatarUrl(user) {
  if (!user) {
    return "";
  }

  return (
    user.hd_profile_pic_url_info?.url ||
    user.profile_pic_url_hd ||
    user.profile_pic_url ||
    user.profile_pic_url_info?.url ||
    ""
  );
}

  function parseRestUsers(users = []) {
    return users.map((user) => ({
      id: String(user.pk),
      username: user.username,
      fullName: user.full_name || "",
      avatarUrl: extractAvatarUrl(user),
    }));
  }

  async function fetchUsersPageRest(userId, session, type, cursor) {
    const params = new URLSearchParams({
      count: String(PAGE_SIZE),
      search_surface: "follow_list_page",
      enable_groups: "true",
    });
    if (cursor) {
      params.set("max_id", cursor);
    }

    const data = await fetchInstagram(
      `/friendships/${userId}/${type}/?${params}`,
      session
    );

    return {
      users: parseRestUsers(data.users),
      nextCursor: data.next_max_id || null,
      hasMore: Boolean(data.next_max_id),
    };
  }

  async function fetchUsersPageGraphql(userId, session, type, cursor) {
    const docId = GRAPHQL_DOCS[type];
    const edgeName = GRAPHQL_EDGES[type];
    const variables = {
      id: userId,
      include_reel: true,
      fetch_mutual: false,
      first: PAGE_SIZE,
    };
    if (cursor) {
      variables.after = cursor;
    }

    const params = new URLSearchParams({
      doc_id: docId,
      variables: JSON.stringify(variables),
    });

    const response = await fetch(
      `https://www.instagram.com/graphql/query/?${params}`,
      {
        credentials: "include",
        headers: buildHeaders(session),
      }
    );

    if (!response.ok) {
      const details = await readError(response);
      throw new Error(
        `Erreur GraphQL (${response.status})${details ? `: ${details}` : ""}`
      );
    }

    const data = await response.json();
    const connection = data?.data?.user?.[edgeName];
    const users = (connection?.edges || [])
      .map((edge) => edge?.node)
      .filter((node) => node?.id && node?.username)
      .map((node) => ({
        id: String(node.id),
        username: node.username,
        fullName: node.full_name || "",
        avatarUrl: extractAvatarUrl(node),
      }));

    const pageInfo = connection?.page_info;
    return {
      users,
      nextCursor: pageInfo?.has_next_page ? pageInfo.end_cursor : null,
      hasMore: Boolean(pageInfo?.has_next_page),
    };
  }

  async function fetchUsersPage(userId, session, type, cursor) {
    if (useGraphql) {
      return fetchUsersPageGraphql(userId, session, type, cursor);
    }

    try {
      return await fetchUsersPageRest(userId, session, type, cursor);
    } catch (error) {
      if (!String(error.message).includes("(400)")) {
        throw error;
      }
      useGraphql = true;
      return fetchUsersPageGraphql(userId, session, type, cursor);
    }
  }

  async function getLoggedInUser(session) {
    if (session.userId) {
      try {
        const data = await fetchInstagram(`/users/${session.userId}/info/`, session);
        const user = data?.user;

        if (user?.username) {
          return {
            id: String(session.userId),
            username: user.username,
            fullName: user.full_name || "",
            avatarUrl: extractAvatarUrl(user),
            followerCount: user.follower_count || 0,
            followingCount: user.following_count || 0,
          };
        }
      } catch {
        // On retente via current_user ci-dessous.
      }
    }

    const data = await fetchInstagram("/accounts/current_user/?edit=true", session);
    const user = data?.user;

    if (!user?.pk || !user?.username) {
      throw new Error(
        "Impossible de lire votre compte. Déconnectez-vous puis reconnectez-vous sur instagram.com."
      );
    }

    session.userId = String(user.pk);

    return {
      id: String(user.pk),
      username: user.username,
      fullName: user.full_name || "",
      avatarUrl: extractAvatarUrl(user),
      followerCount: user.follower_count || 0,
      followingCount: user.following_count || 0,
    };
  }

  async function unfollowUser(targetUserId, session) {
    const body = new URLSearchParams({ user_id: String(targetUserId) });
    await fetchInstagram(`/friendships/destroy/${targetUserId}/`, session, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  }

  function emitProgress(onProgress, payload) {
    onProgress?.(payload);
  }

  function resetAnalysisState() {
    analysisState = null;
  }

  async function loadFollowers(onProgress, sessionOverride) {
    const session = getSession(sessionOverride);
    const profile = await getLoggedInUser(session);

    emitProgress(onProgress, {
      phase: "init",
      message: `Compte Instagram détecté : @${profile.username}`,
      step: 1,
      totalSteps: 3,
      percent: 2,
      profile,
      username: profile.username,
    });

    const followers = new Map();
    let cursor = null;
    let pageIndex = 0;

    emitProgress(onProgress, {
      phase: "followers",
      message: "Étape 1/3 — On récupère vos followers pour comparer…",
      step: 1,
      totalSteps: 3,
      loaded: 0,
      total: profile.followerCount,
      percent: 5,
    });

    do {
      const page = await fetchUsersPage(profile.id, session, "followers", cursor);
      for (const user of page.users) {
        followers.set(user.id, user);
      }

      pageIndex += 1;
      cursor = page.nextCursor;

      const loaded = followers.size;
      const total = Math.max(profile.followerCount, loaded, 1);
      const percent = 5 + Math.round((loaded / total) * 40);

      emitProgress(onProgress, {
        phase: "followers",
        message: `Followers chargés : ${loaded}${profile.followerCount ? ` / ~${profile.followerCount}` : ""}`,
        step: 1,
        totalSteps: 3,
        loaded,
        total: profile.followerCount,
        pageIndex,
        percent,
      });

      if (cursor) {
        await delay(REQUEST_DELAY_MS);
      }
    } while (cursor);

    analysisState = {
      session,
      userId: profile.id,
      username: profile.username,
      profile,
      followers,
      followingTotal: profile.followingCount,
      followingCursor: null,
      followingChecked: 0,
      followingBuffer: [],
      nonFollowers: [],
      done: false,
      batchSize: DEFAULT_BATCH_SIZE,
    };

    emitProgress(onProgress, {
      phase: "followers-done",
      message: `${followers.size} followers prêts — on passe aux abonnements.`,
      step: 1,
      totalSteps: 3,
      loaded: followers.size,
      total: profile.followerCount,
      percent: 45,
      stats: {
        followers: followers.size,
        following: profile.followingCount,
        nonFollowers: 0,
      },
      username: profile.username,
      profile,
    });

    return {
      username: profile.username,
      profile,
      stats: {
        followers: followers.size,
        following: profile.followingCount,
        nonFollowers: 0,
      },
    };
  }

  async function fillFollowingBuffer() {
    while (
      analysisState.followingBuffer.length === 0 &&
      !analysisState.done
    ) {
      const page = await fetchUsersPage(
        analysisState.userId,
        analysisState.session,
        "following",
        analysisState.followingCursor
      );

      analysisState.followingCursor = page.nextCursor;
      if (!page.hasMore) {
        analysisState.done = true;
      }

      analysisState.followingBuffer.push(...page.users);

      if (page.hasMore) {
        await delay(REQUEST_DELAY_MS);
      }

      if (!page.users.length && !page.hasMore) {
        analysisState.done = true;
      }
    }
  }

  async function analyzeNextBatch(batchSize = DEFAULT_BATCH_SIZE, onProgress) {
    if (!analysisState) {
      throw new Error("Lancez d'abord l'analyse (étape followers).");
    }

    const size = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
    const batchChecked = [];
    const batchFound = [];

    emitProgress(onProgress, {
      phase: "following",
      message: `Étape 2/3 — Analyse de ${size} abonnements…`,
      step: 2,
      totalSteps: 3,
      batchSize: size,
      percent: 46,
    });

    while (batchChecked.length < size && !analysisState.done) {
      await fillFollowingBuffer();

      const user = analysisState.followingBuffer.shift();
      if (!user) {
        analysisState.done = true;
        break;
      }

      analysisState.followingChecked += 1;
      batchChecked.push(user);

      if (!analysisState.followers.has(user.id)) {
        analysisState.nonFollowers.push(user);
        batchFound.push(user);
      }
    }

    analysisState.nonFollowers.sort((a, b) =>
      a.username.localeCompare(b.username)
    );

    const followingTotal = Math.max(
      analysisState.followingTotal,
      analysisState.followingChecked,
      1
    );
    const percent =
      46 + Math.round((analysisState.followingChecked / followingTotal) * 50);

    const payload = {
      phase: analysisState.done ? "complete" : "batch",
      message: analysisState.done
        ? "Analyse terminée — voici vos résultats !"
        : `Lot analysé : ${batchChecked.length} compte(s), ${batchFound.length} sans retour.`,
      step: analysisState.done ? 3 : 2,
      totalSteps: 3,
      batchChecked,
      batchFound,
      checkedTotal: analysisState.followingChecked,
      followingTotal: analysisState.followingTotal,
      hasMore: !analysisState.done,
      done: analysisState.done,
      percent: analysisState.done ? 100 : Math.min(percent, 99),
      stats: {
        followers: analysisState.followers.size,
        following: analysisState.followingTotal,
        nonFollowers: analysisState.nonFollowers.length,
      },
      nonFollowers: analysisState.nonFollowers,
      username: analysisState.username,
      profile: analysisState.profile,
    };

    emitProgress(onProgress, payload);

    return {
      username: analysisState.username,
      profile: analysisState.profile,
      stats: payload.stats,
      nonFollowers: analysisState.nonFollowers,
      batchChecked,
      batchFound,
      hasMore: !analysisState.done,
      done: analysisState.done,
    };
  }

  async function analyzeAllBatches(batchSize, onProgress, sessionOverride) {
    resetAnalysisState();
    useGraphql = false;

    emitProgress(onProgress, {
      phase: "init",
      message: "Connexion à Instagram en cours…",
      step: 1,
      totalSteps: 3,
      percent: 3,
    });

    await loadFollowers(onProgress, sessionOverride);

    let batchNumber = 0;
    let result = null;

    do {
      batchNumber += 1;
      result = await analyzeNextBatch(batchSize, onProgress);

      emitProgress(onProgress, {
        ...result,
        phase: result.done ? "complete" : "batch",
        batchNumber,
        message: result.done
          ? `Terminé ! ${result.stats.nonFollowers} compte(s) ne vous suivent pas.`
          : `Lot ${batchNumber} terminé — ${result.batchChecked.length} vérifiés, ${result.batchFound.length} sans retour.`,
      });

      if (!result.done) {
        await delay(200);
      }
    } while (!result.done);

    return result;
  }

  async function unfollowBatch(users, delayMs, onProgress, sessionOverride) {
    const session = getSession(sessionOverride);
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      try {
        await unfollowUser(user.id, session);
        results.success += 1;
      } catch (error) {
        results.failed += 1;
        results.errors.push({
          username: user.username,
          message: error.message || String(error),
        });
      }

      onProgress?.({
        phase: "unfollow",
        current: i + 1,
        total: users.length,
        user,
        results,
        percent: Math.round(((i + 1) / users.length) * 100),
        message: `Désabonnement de @${user.username}…`,
      });

      if (i < users.length - 1) {
        await delay(delayMs);
      }
    }

    return results;
  }

  function dispatchResponse(detail) {
    postToContent(detail);
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== CONTENT_SOURCE) {
      return;
    }

    const { requestId, action, payload } = event.data;
    const sessionOverride = payload?.sessionCookies || {};

    const onProgress = (progress) => {
      dispatchResponse({ requestId, progress: true, progressData: progress });
    };

    try {
      if (action === "profile") {
        const session = getSession(sessionOverride);
        const profile = await getLoggedInUser(session);
        dispatchResponse({ requestId, ok: true, result: { profile } });
        return;
      }

      if (action === "analyze") {
        const batchSize = payload?.batchSize || DEFAULT_BATCH_SIZE;
        const result = await analyzeAllBatches(
          batchSize,
          onProgress,
          sessionOverride
        );
        dispatchResponse({ requestId, ok: true, result });
        return;
      }

      if (action === "analyze-batch") {
        const result = await analyzeNextBatch(payload?.batchSize, onProgress);
        dispatchResponse({ requestId, ok: true, result });
        return;
      }

      if (action === "analyze-reset") {
        resetAnalysisState();
        dispatchResponse({ requestId, ok: true, result: { reset: true } });
        return;
      }

      if (action === "unfollow") {
        const result = await unfollowBatch(
          payload.users,
          payload.delayMs,
          onProgress,
          sessionOverride
        );
        dispatchResponse({ requestId, ok: true, result });
        return;
      }

      dispatchResponse({ requestId, ok: false, error: "Action inconnue." });
    } catch (error) {
      dispatchResponse({
        requestId,
        ok: false,
        error: error.message || String(error),
      });
    }
  });

  postToContent({ type: "ready" });
})();
