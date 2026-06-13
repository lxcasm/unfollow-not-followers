const ext = globalThis.browser ?? globalThis.chrome;
const EXTENSION_VERSION = "2.3.1";

const MONETIZATION = {
  FREE_UNFOLLOWS: 15,
  ANALYSIS_BATCH_SIZE: 15,
  UNFOLLOW_DELAY_MS: 2000,
  AD_WATCH_SECONDS: 8,
  STORAGE_KEY: "unfollowMonetization",
  sponsorUrl: "https://github.com/lxcasm",
  sponsorTitle: "lxcasm · Développeur",
  sponsorText:
    "Extension gratuite sans réseau pub — visitez mon profil pour suivre le projet et me soutenir.",
  sponsorCta: "Voir le profil",
};

async function loadMonetizationState() {
  const stored = await ext.storage.local.get(MONETIZATION.STORAGE_KEY);
  const defaults = {
    unfollowCredits: 0,
    needsAdForAnalysis: false,
    totalUnfollowsUsed: 0,
    hasCompletedFirstAnalysis: false,
  };
  return { ...defaults, ...(stored[MONETIZATION.STORAGE_KEY] || {}) };
}

async function saveMonetizationState(state) {
  await ext.storage.local.set({ [MONETIZATION.STORAGE_KEY]: state });
}

async function grantAnalysisReward(state) {
  state.unfollowCredits = MONETIZATION.FREE_UNFOLLOWS;
  state.needsAdForAnalysis = false;
  state.hasCompletedFirstAnalysis = true;
  await saveMonetizationState(state);
  return state;
}

async function consumeUnfollowCredits(state, count) {
  state.unfollowCredits = Math.max(0, state.unfollowCredits - count);
  state.totalUnfollowsUsed += count;
  if (state.unfollowCredits <= 0) {
    state.needsAdForAnalysis = true;
  }
  await saveMonetizationState(state);
  return state;
}

async function unlockAfterAd(state) {
  state.needsAdForAnalysis = false;
  await saveMonetizationState(state);
  return state;
}

async function resetMonetizationState() {
  const current = await loadMonetizationState();
  const state = {
    unfollowCredits: 0,
    needsAdForAnalysis: current.hasCompletedFirstAnalysis,
    totalUnfollowsUsed: 0,
    hasCompletedFirstAnalysis: current.hasCompletedFirstAnalysis,
  };
  await saveMonetizationState(state);
  return state;
}

function canAnalyze(state) {
  if (!state.hasCompletedFirstAnalysis) {
    return true;
  }
  return !state.needsAdForAnalysis;
}

function canUnfollow(state, availableCount) {
  return state.unfollowCredits > 0 && availableCount > 0;
}

function getUnfollowLimit(state, availableCount) {
  return Math.min(state.unfollowCredits, MONETIZATION.FREE_UNFOLLOWS, availableCount);
}

const analyzeBtn = document.getElementById("analyzeBtn");
const analyzeBtnLabel = document.getElementById("analyzeBtnLabel");
const unfollowBtn = document.getElementById("unfollowBtn");
const unfollowBtnLabel = document.getElementById("unfollowBtnLabel");
const progressPanel = document.getElementById("progressPanel");
const progressPhase = document.getElementById("progressPhase");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const progressMessage = document.getElementById("progressMessage");
const statsPanel = document.getElementById("statsPanel");
const statFollowers = document.getElementById("statFollowers");
const statFollowing = document.getElementById("statFollowing");
const statNonFollowers = document.getElementById("statNonFollowers");
const resultsPanel = document.getElementById("resultsPanel");
const resultsCount = document.getElementById("resultsCount");
const userListEl = document.getElementById("userList");
const emptyState = document.getElementById("emptyState");
const statusEl = document.getElementById("status");
const stepEls = [...document.querySelectorAll(".step")];
const creditsPanel = document.getElementById("creditsPanel");
const creditsTitle = document.getElementById("creditsTitle");
const creditsDesc = document.getElementById("creditsDesc");
const creditsBadge = document.getElementById("creditsBadge");
const adBanner = document.getElementById("adBanner");
const adBannerLink = document.getElementById("adBannerLink");
const adBannerTitle = document.getElementById("adBannerTitle");
const adBannerText = document.getElementById("adBannerText");
const adModal = document.getElementById("adModal");
const adModalLink = document.getElementById("adModalLink");
const adModalTitle = document.getElementById("adModalTitle");
const adModalText = document.getElementById("adModalText");
const adModalCta = document.getElementById("adModalCta");
const adTimerBar = document.getElementById("adTimerBar");
const adTimerLabel = document.getElementById("adTimerLabel");
const adContinueBtn = document.getElementById("adContinueBtn");
const adCancelBtn = document.getElementById("adCancelBtn");
const errorBanner = document.getElementById("errorBanner");
const profilePanel = document.getElementById("profilePanel");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileUsername = document.getElementById("profileUsername");
const profileMeta = document.getElementById("profileMeta");
const profileFollowers = document.getElementById("profileFollowers");
const profileFollowing = document.getElementById("profileFollowing");
const profileStatus = document.getElementById("profileStatus");

let analysis = null;
let renderedUserIds = new Set();
let monetizationState = null;
let adTimerInterval = null;
let pendingAnalyzeAfterAd = false;
const avatarDataUrlCache = new Map();

const phaseLabels = {
  init: "Connexion",
  followers: "Étape 1 — Followers",
  "followers-done": "Followers prêts",
  following: "Étape 2 — Abonnements",
  batch: "Analyse par lots",
  complete: "Terminé",
  unfollow: "Désabonnement",
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function showError(message) {
  if (!message) {
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
    return;
  }
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
  setStatus(message, true);
}

function assertRuntimeReady() {
  if (!ext?.runtime?.sendMessage) {
    throw new Error("API navigateur indisponible. Rechargez l'extension dans about:debugging.");
  }
}

async function sendToInstagram(message) {
  const response = await ext.runtime.sendMessage({
    type: "SEND_TO_INSTAGRAM",
    payload: message,
  });

  if (!response) {
    throw new Error(
      "Le service extension ne répond pas. Supprimez puis rechargez l'extension dans about:debugging."
    );
  }

  return response;
}

function setBusy(isBusy) {
  analyzeBtn.disabled = isBusy;
  updateActionButtons();
}

function updateActionButtons() {
  const available = analysis?.nonFollowers?.length || 0;
  const limit = monetizationState
    ? getUnfollowLimit(monetizationState, available)
    : 0;

  unfollowBtn.disabled =
    analyzeBtn.disabled || !canUnfollow(monetizationState || {}, available);

  if (available > 0 && limit > 0) {
    unfollowBtnLabel.textContent = `Désabonner ${limit} compte${limit > 1 ? "s" : ""}`;
  } else if ((monetizationState?.unfollowCredits || 0) <= 0) {
    unfollowBtnLabel.textContent = "Crédits épuisés — soutien requis";
  } else {
    unfollowBtnLabel.textContent = "Désabonner les comptes trouvés";
  }

  if (monetizationState?.needsAdForAnalysis) {
    analyzeBtn.classList.add("btn-locked");
    analyzeBtnLabel.textContent = "Visiter le profil pour analyser";
  } else {
    analyzeBtn.classList.remove("btn-locked");
    analyzeBtnLabel.textContent = monetizationState?.hasCompletedFirstAnalysis
      ? "Relancer l'analyse Instagram"
      : "Analyser mon Instagram";
  }
}

function updateCreditsUI() {
  if (!monetizationState) {
    return;
  }

  const credits = monetizationState.unfollowCredits;
  creditsBadge.textContent = String(credits);
  creditsBadge.classList.toggle("empty", credits <= 0);
  creditsPanel.classList.toggle("locked", monetizationState.needsAdForAnalysis);

  if (monetizationState.needsAdForAnalysis) {
    creditsTitle.textContent = "Crédits épuisés";
    creditsDesc.textContent =
      "Regardez le profil du développeur pour relancer une analyse et obtenir 15 désabonnements.";
  } else if (!monetizationState.hasCompletedFirstAnalysis) {
    creditsTitle.textContent = "Première analyse gratuite";
    creditsDesc.textContent =
      "Lancez l'analyse pour obtenir 15 désabonnements (0 crédit tant que l'analyse n'est pas faite).";
  } else {
    creditsTitle.textContent = `${credits} désabonnement${credits > 1 ? "s" : ""} restant${credits > 1 ? "s" : ""}`;
    creditsDesc.textContent = "Utilisez-les sur les comptes sans follow-back.";
  }

  updateActionButtons();
}

function setupAdContent() {
  adBannerTitle.textContent = MONETIZATION.sponsorTitle;
  adBannerText.textContent = MONETIZATION.sponsorText;
  adBannerLink.href = MONETIZATION.sponsorUrl;

  adModalTitle.textContent = MONETIZATION.sponsorTitle;
  adModalText.textContent = MONETIZATION.sponsorText;
  adModalCta.textContent = MONETIZATION.sponsorCta;
  adModalLink.href = MONETIZATION.sponsorUrl;

  adBanner.classList.remove("hidden");
}

function setStep(step) {
  stepEls.forEach((el) => {
    const value = Number(el.dataset.step);
    el.classList.toggle("active", value === step);
    el.classList.toggle("done", value < step);
  });
}

function updateProgress(progress) {
  progressPanel.classList.remove("hidden");

  const percent = Math.max(0, Math.min(100, progress.percent || 0));
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressPhase.textContent = phaseLabels[progress.phase] || "Analyse";
  progressMessage.textContent = progress.message || "";

  if (progress.step) {
    setStep(progress.step);
  }

  if (progress.stats) {
    updateStats(progress.stats, progress.username, progress.profile);
  }

  if (progress.profile) {
    void updateProfilePanel(progress.profile, "connected");
  }
}

function updateStats(stats, username, profile) {
  statsPanel.classList.remove("hidden");
  statFollowers.textContent = formatNumber(stats.followers);
  statFollowing.textContent = formatNumber(stats.following);
  statNonFollowers.textContent = formatNumber(stats.nonFollowers);

  if (profile) {
    void updateProfilePanel(profile, "connected");
  } else if (username) {
    setStatus(`Compte Instagram analysé : @${username}`);
  }
}

async function resolveAvatarSrc(avatarUrl) {
  if (!avatarUrl) {
    return null;
  }

  if (avatarDataUrlCache.has(avatarUrl)) {
    return avatarDataUrlCache.get(avatarUrl);
  }

  try {
    const response = await sendToInstagram({ type: "GET_AVATAR", url: avatarUrl });
    if (response?.ok && response.result?.dataUrl) {
      avatarDataUrlCache.set(avatarUrl, response.result.dataUrl);
      return response.result.dataUrl;
    }
  } catch {
    // On retente avec l'URL directe.
  }

  avatarDataUrlCache.set(avatarUrl, avatarUrl);
  return avatarUrl;
}

async function fillAvatarElement(container, user, sizeClass = "") {
  container.className = sizeClass || container.className;
  container.replaceChildren();

  const initial = (user.username || "IG").slice(0, 1).toUpperCase();

  if (user.avatarUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    container.appendChild(img);

    const src = await resolveAvatarSrc(user.avatarUrl);
    if (src) {
      img.src = src;
    }

    img.addEventListener("error", () => {
      img.remove();
      container.textContent = initial;
    });
    return;
  }

  container.textContent = initial;
}

async function updateProfilePanel(profile, status = "connected") {
  if (!profile?.username) {
    return;
  }

  await fillAvatarElement(profileAvatar, profile, "profile-avatar");
  profileName.textContent = profile.fullName || `@${profile.username}`;
  profileUsername.textContent = `@${profile.username}`;
  profileMeta.classList.remove("hidden");
  profileFollowers.textContent = `${formatNumber(profile.followerCount)} followers`;
  profileFollowing.textContent = `${formatNumber(profile.followingCount)} abonnements`;
  profilePanel.classList.add("connected");
  profilePanel.classList.remove("waiting", "error");

  if (status === "loading") {
    profileStatus.textContent = "Connexion…";
    profileStatus.className = "profile-status loading";
    return;
  }

  if (status === "error") {
    profileStatus.textContent = "Hors ligne";
    profileStatus.className = "profile-status error";
    return;
  }

  profileStatus.textContent = "Connecté";
  profileStatus.className = "profile-status connected";
}

function setProfileWaiting(message = "Ouvrez instagram.com pour détecter votre profil") {
  profileAvatar.replaceChildren();
  profileAvatar.textContent = "IG";
  profileName.textContent = "Connectez-vous sur instagram.com";
  profileUsername.textContent = message;
  profileMeta.classList.add("hidden");
  profilePanel.classList.remove("connected", "error");
  profilePanel.classList.add("waiting");
  profileStatus.textContent = "En attente";
  profileStatus.className = "profile-status waiting";
}

async function loadInstagramProfile() {
  setProfileWaiting("Détection de votre compte Instagram…");
  profileStatus.textContent = "Connexion…";
  profileStatus.className = "profile-status loading";

  try {
    const response = await sendToInstagram({ type: "GET_PROFILE" });

    if (!response?.ok || !response.result?.profile) {
      throw new Error(response?.error || "Profil introuvable.");
    }

    await updateProfilePanel(response.result.profile, "connected");
    setStatus(`Compte Instagram connecté : @${response.result.profile.username}`);
  } catch (error) {
    if (String(error.message).includes("instagram.com")) {
      setProfileWaiting();
      return;
    }

    setProfileWaiting(error.message);
    profilePanel.classList.add("error");
    profileStatus.textContent = "Erreur";
    profileStatus.className = "profile-status error";
  }
}

function formatNumber(value) {
  if (value === undefined || value === null) {
    return "—";
  }
  return new Intl.NumberFormat("fr-FR").format(value);
}

async function renderUserList(users, append = false) {
  resultsPanel.classList.remove("hidden");

  if (!append) {
    userListEl.replaceChildren();
    renderedUserIds = new Set();
  }

  if (!users.length && !append) {
    emptyState.classList.remove("hidden");
    resultsCount.textContent = "0";
    return;
  }

  emptyState.classList.add("hidden");

  for (const user of users) {
    if (renderedUserIds.has(user.id)) {
      continue;
    }
    renderedUserIds.add(user.id);

    const item = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "user-meta";

    if (user.fullName) {
      const fullName = document.createElement("span");
      fullName.className = "fullname";
      fullName.textContent = user.fullName;
      meta.appendChild(fullName);
    }

    const username = document.createElement("span");
    username.className = "username";
    username.textContent = `@${user.username}`;
    meta.appendChild(username);

    const badge = document.createElement("span");
    badge.className = "user-badge";
    badge.textContent = "Sans follow-back";

    const avatar = document.createElement("div");
    avatar.className = "user-avatar";
    avatar.textContent = (user.username || "IG").slice(0, 1).toUpperCase();
    void fillAvatarElement(avatar, user, "user-avatar");

    item.appendChild(avatar);
    item.appendChild(meta);
    item.appendChild(badge);
    userListEl.appendChild(item);
  }

  resultsCount.textContent = String(renderedUserIds.size);
}

function stopAdTimer() {
  if (adTimerInterval) {
    clearInterval(adTimerInterval);
    adTimerInterval = null;
  }
}

function showAdModal() {
  pendingAnalyzeAfterAd = true;
  adModal.classList.remove("hidden");
  adContinueBtn.disabled = true;
  setStatus("Merci pour votre soutien — vous pouvez continuer dans quelques secondes.");

  const totalSeconds = MONETIZATION.AD_WATCH_SECONDS;
  let elapsed = 0;
  adTimerBar.style.width = "0%";
    adTimerLabel.textContent = `Visite en cours… ${totalSeconds} s`;

  stopAdTimer();
  adTimerInterval = setInterval(() => {
    elapsed += 1;
    const progress = Math.min(100, (elapsed / totalSeconds) * 100);
    adTimerBar.style.width = `${progress}%`;
    const remaining = Math.max(0, totalSeconds - elapsed);
    adTimerLabel.textContent =
      remaining > 0
        ? `Visite en cours… ${remaining} s`
        : "Merci ! Vous pouvez continuer.";

    if (elapsed >= totalSeconds) {
      stopAdTimer();
      adContinueBtn.disabled = false;
    }
  }, 1000);
}

function hideAdModal() {
  stopAdTimer();
  adModal.classList.add("hidden");
  pendingAnalyzeAfterAd = false;
}

async function runAnalysis() {
  setBusy(true);
  setStep(1);
  analysis = null;
  renderedUserIds = new Set();
  userListEl.replaceChildren();
  emptyState.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  statsPanel.classList.add("hidden");
  progressPanel.classList.remove("hidden");
  updateProgress({
    phase: "init",
    step: 1,
    percent: 1,
    message: "On se connecte à Instagram et on prépare l'analyse…",
  });

  const batchSize = MONETIZATION.ANALYSIS_BATCH_SIZE;

  const progressListener = (message) => {
    if (message.type !== "EXTENSION_PROGRESS") {
      return;
    }

    const progress = message.progress;
    updateProgress(progress);

    if (progress.batchFound?.length) {
      void renderUserList(progress.batchFound, true);
    } else if (progress.nonFollowers?.length) {
      void renderUserList(progress.nonFollowers, false);
    }
  };

  ext.runtime.onMessage.addListener(progressListener);

  try {
    const response = await sendToInstagram({
      type: "ANALYZE",
      batchSize,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Analyse impossible. Rafraîchissez Instagram (F5).");
    }

    analysis = response.result;
    monetizationState = await grantAnalysisReward(monetizationState);
    updateCreditsUI();

    if (analysis.profile) {
      await updateProfilePanel(analysis.profile, "connected");
    }

    updateStats(analysis.stats, analysis.username, analysis.profile);
    await renderUserList(analysis.nonFollowers || [], false);
    updateProgress({
      phase: "complete",
      step: 3,
      percent: 100,
      message:
        analysis.stats.nonFollowers > 0
          ? `${analysis.stats.nonFollowers} compte(s) sans retour — ${monetizationState.unfollowCredits} désabonnements disponibles.`
          : "Bravo ! Tous vos abonnements vous suivent en retour.",
      stats: analysis.stats,
    });

    setStatus(
      analysis.stats.nonFollowers > 0
        ? `${monetizationState.unfollowCredits} désabonnements gratuits prêts à l'emploi.`
        : "Analyse terminée — rien à nettoyer."
    );
  } catch (error) {
    showError(error.message);
    progressMessage.textContent = error.message;
    progressPhase.textContent = "Erreur";
  } finally {
    ext.runtime.onMessage.removeListener(progressListener);
    setBusy(false);
    updateActionButtons();
  }
}

analyzeBtn.addEventListener("click", async () => {
  try {
    showError("");
    assertRuntimeReady();
    analyzeBtnLabel.textContent = "Démarrage…";
    setBusy(true);
    setStatus("Connexion à Instagram…");
    progressPanel.classList.remove("hidden");
    progressPhase.textContent = "Démarrage";
    progressMessage.textContent = "Recherche de votre onglet Instagram…";
    progressPercent.textContent = "0%";
    progressBar.style.width = "0%";

    monetizationState = await loadMonetizationState();

    if (!canAnalyze(monetizationState)) {
      setBusy(false);
      showAdModal();
      setStatus("Visitez le profil du développeur pour débloquer une nouvelle analyse.");
      return;
    }

    await runAnalysis();
  } catch (error) {
    showError(error.message || String(error));
    progressPhase.textContent = "Erreur";
    progressMessage.textContent = error.message || String(error);
    setBusy(false);
    updateActionButtons();
  }
});

adContinueBtn.addEventListener("click", async () => {
  monetizationState = await unlockAfterAd(monetizationState);
  updateCreditsUI();
  hideAdModal();
  await runAnalysis();
});

adCancelBtn.addEventListener("click", () => {
  hideAdModal();
  setStatus("Analyse verrouillée — visitez le profil développeur pour continuer.");
});

unfollowBtn.addEventListener("click", async () => {
  if (!analysis?.nonFollowers?.length) {
    return;
  }

  monetizationState = await loadMonetizationState();
  const limit = getUnfollowLimit(monetizationState, analysis.nonFollowers.length);

  if (limit <= 0) {
    showAdModal();
    return;
  }

  const targets = analysis.nonFollowers.slice(0, limit);
  const confirmed = confirm(
    `Vous allez vous désabonner de ${targets.length} compte(s) (${monetizationState.unfollowCredits} crédit(s) restant(s) après).\n\nContinuer ?`
  );

  if (!confirmed) {
    return;
  }

  setBusy(true);
  const delayMs = MONETIZATION.UNFOLLOW_DELAY_MS;

  const progressListener = (message) => {
    if (message.type !== "EXTENSION_PROGRESS") {
      return;
    }

    const progress = message.progress;
    updateProgress({
      phase: "unfollow",
      step: 3,
      percent: progress.percent || 0,
      message: progress.message || `Désabonnement ${progress.current}/${progress.total}…`,
    });
  };

  ext.runtime.onMessage.addListener(progressListener);

  try {
    const response = await sendToInstagram({
      type: "UNFOLLOW",
      users: targets,
      delayMs,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Désabonnement impossible.");
    }

    const { success, failed } = response.result;
    monetizationState = await consumeUnfollowCredits(monetizationState, success);
    updateCreditsUI();

    analysis.nonFollowers = analysis.nonFollowers.slice(success);
    await renderUserList(analysis.nonFollowers, false);
    analysis.stats.nonFollowers = analysis.nonFollowers.length;
    updateStats(analysis.stats, analysis.username);

    updateProgress({
      phase: "complete",
      step: 3,
      percent: 100,
      message:
        monetizationState.needsAdForAnalysis
          ? ` ${success} désabonnement(s) effectué(s). Visitez le profil développeur pour relancer l'analyse.`
          : `Nettoyage terminé : ${success} ok, ${failed} erreur(s). ${monetizationState.unfollowCredits} crédit(s) restants.`,
    });

    setStatus(
      monetizationState.needsAdForAnalysis
        ? "15 désabonnements utilisés — visite développeur requise pour continuer."
        : `Terminé : ${success} compte(s) retirés.`
    );
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    ext.runtime.onMessage.removeListener(progressListener);
    setBusy(false);
    updateActionButtons();
  }
});

async function init() {
  try {
    if (!analyzeBtn) {
      throw new Error("Interface popup incomplète. Rechargez l'extension.");
    }

    assertRuntimeReady();

    let version = EXTENSION_VERSION;
    try {
      const ping = await ext.runtime.sendMessage({ type: "PING_BACKGROUND" });
      version = ping?.version || EXTENSION_VERSION;
    } catch {
      // Le background peut mettre une seconde à démarrer après le chargement.
    }

    setupAdContent();
    monetizationState = await loadMonetizationState();
    updateCreditsUI();
    setStatus(`Extension v${version} prête — ouvrez instagram.com puis analysez.`);
    loadInstagramProfile().catch(() => {});
  } catch (error) {
    showError(error.message || String(error));
  }
}

window.addEventListener("error", (event) => {
  showError(event.error?.message || event.message || "Erreur inattendue.");
});

window.addEventListener("unhandledrejection", (event) => {
  showError(event.reason?.message || String(event.reason));
});

init();
