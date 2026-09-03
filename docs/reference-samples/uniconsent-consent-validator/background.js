const CLEANUP_INTERVAL = 60 * 60 * 1000;

// status: "pass" | "warning" | "error" | "none"
function updateBadge(status) {
  const config = {
    pass:    { color: "#16a34a", text: "OK" },
    warning: { color: "#ca8a04", text: "!" },
    error:   { color: "#dc2626", text: "ERR" },
    none:    { color: "#aaaaaa", text: "" },
  };
  const c = config[status] || config.none;
  chrome.action.setBadgeBackgroundColor({ color: c.color });
  chrome.action.setBadgeText({ text: c.text });
}

async function updateConsentStatus(tabId, updateData) {
  try {
    const tabData = await chrome.storage.local.get([tabId]);
    const parsedTabData = tabData?.[tabId] || {};
    parsedTabData.history = (parsedTabData.history || []).concat(updateData);
    await chrome.storage.local.set({ [tabId]: parsedTabData });
  } catch (error) {
    console.log("Error updating consent status:", error);
  }
}

function getLastElement(arr) {
  return arr && arr.length > 0 ? arr[arr.length - 1] : null;
}

function computeBadgeStatus(consentModeData, diagnostics) {
  const check = consentModeData?.check || {};
  const diag = diagnostics || {};

  const hasConsentModeData = check.usedDefault !== undefined || check.usedUpdate !== undefined || check.wasSetLate !== undefined;
  const hasGoogleTags = diag.gtagLoaded || diag.gtagDataFound || diag.adsActive || hasConsentModeData;

  if (!hasGoogleTags) return "none";

  if (check.usedDefault === false) return "error";
  if (check.wasSetLate === true) return "error";
  if (diag.gtagConsentDefaultExists && !diag.gtagConsentDefaultOrder) return "error";

  if (hasGoogleTags && check.usedDefault !== true && check.usedUpdate !== true) return "warning";
  if (diag.adsActive && !diag.gcmActive) return "warning";

  return "pass";
}

async function refreshBadge() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || tabs.length === 0) return;

    const tabIdStr = tabs[0].id.toString();
    const consentMode = await chrome.storage.local.get([tabIdStr + "_consentmode"]);
    const diagnosticsData = await chrome.storage.local.get([tabIdStr + "_diagnostics"]);

    const cmData = getLastElement(consentMode[tabIdStr + "_consentmode"]?.history);
    const diag = diagnosticsData[tabIdStr + "_diagnostics"] || null;

    if (!cmData && !diag) {
      updateBadge("none");
    } else {
      updateBadge(computeBadgeStatus(cmData, diag));
    }
  } catch (e) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.subject === "startup" && tabId) {
    clearTabData(tabId + "_gcs");
    clearTabData(tabId + "_consentmode");
    clearTabData(tabId + "_tcf");
    clearTabData(tabId + "_gpp");
    clearTabData(tabId + "_diagnostics");
    updateBadge("none");
    sendResponse({ message: "Tab data cleared" });
  }

  if (message.subject === "consentmode" && tabId) {
    updateConsentStatus(tabId + "_consentmode", message.body);
  }

  if (message.subject === "tcf" && tabId) {
    updateConsentStatus(tabId + "_tcf", message.body);
  }

  if (message.subject === "gpp" && tabId) {
    updateConsentStatus(tabId + "_gpp", message.body);
  }

  if (message.subject === "diagnostics" && tabId) {
    chrome.storage.local.set({ [tabId + "_diagnostics"]: message.body });
  }

  if (message.subject === "uet") {
    updateConsentStatus(sender.tab.id + "_uet", message.body);
  }

  if (message.subject === "clear-storage") {
    cleanupStorage();
  }

  return true;
});

function extractDataFromUrlParams(urlParams) {
  let consentActive = urlParams.has("gcs");
  const gcsCode = urlParams.get("gcs") || "None";
  const gcdCode = urlParams.get("gcd") || "None";
  const npa = urlParams.get("npa") || "None";
  const tcfd = urlParams.get("tcfd") || "None";

  return {
    consentActive,
    gcsCode,
    gcdCode,
    npa,
  };
}

chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    try {
      let queryString = details.url.split("?")[1];
      if (!queryString) return;
      let urlParams = new URLSearchParams(queryString);
      if (urlParams.has("gcs")) {
        let gcsData = extractDataFromUrlParams(urlParams);
        updateConsentStatus(details.tabId + "_gcs", gcsData);
      }
    } catch (e) {
      console.log(e);
    }
  },
  { urls: ["<all_urls>"] }
);

function handleUetTag() {
  chrome.webRequest.onHeadersReceived.hasListener(handleURLHeaderReceived) ||
    chrome.webRequest.onHeadersReceived.addListener(handleURLHeaderReceived, {
      urls: [
        "https://bat.bing.com/action/*",
        "https://commerce.bing.com/cst/0*",
        "https://mtag.microsoft.com/tags/*",
      ],
    });
}

function handleURLHeaderReceived(e) {
  updateConsentStatus(e.tabId + "_uet_tag", { tagStatus: true });
}
function clearTabData(tabId) {
  try {
    chrome.storage.local.remove([tabId.toString()]);
  } catch (error) {
    console.error("Error clearing consent data:", error);
  }
}
handleUetTag();

// Refresh badge on any storage change, tab switch, or page load
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === "local") {
    refreshBadge();
  }
});

chrome.tabs.onActivated.addListener(function () {
  refreshBadge();
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === "complete" && tab.active) {
    refreshBadge();
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  clearTabData(tabId + "_gcs");
  clearTabData(tabId + "_consentmode");
  clearTabData(tabId + "_tcf");
  clearTabData(tabId + "_gpp");
  clearTabData(tabId + "_diagnostics");
  clearTabData(tabId + "_uet");
  clearTabData(tabId + "_uet_tag");
});

function cleanupStorage() {
  chrome.tabs
    .query({})
    .then((tabs) => {
      const openTabIds = tabs.map((tab) => tab.id.toString());
      chrome.storage.local.get(null).then((items) => {
        const storedKeys = Object.keys(items);
        const keysToRemove = storedKeys.filter((key) => {
          const tabId = key.split("_")[0];
          return !openTabIds.includes(tabId);
        });
        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove);
        }
      });
    })
    .catch((error) => console.error("Error during storage cleanup:", error));
}

setInterval(cleanupStorage, CLEANUP_INTERVAL);
