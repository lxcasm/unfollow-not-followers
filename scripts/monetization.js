const ext = globalThis.browser ?? globalThis.chrome;

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

// Partagé avec popup.js (les const ne sont pas visibles entre fichiers séparés).
globalThis.MONETIZATION = MONETIZATION;
globalThis.loadMonetizationState = loadMonetizationState;
globalThis.saveMonetizationState = saveMonetizationState;
globalThis.grantAnalysisReward = grantAnalysisReward;
globalThis.consumeUnfollowCredits = consumeUnfollowCredits;
globalThis.unlockAfterAd = unlockAfterAd;
globalThis.canAnalyze = canAnalyze;
globalThis.canUnfollow = canUnfollow;
globalThis.getUnfollowLimit = getUnfollowLimit;
