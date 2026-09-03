(function () {
  console.log("UniConsent - Checker Loaded");

  window.postMessage(
    {
      from: "uniconsent-checker",
      subject: "startup",
      body: {},
    },
    "*"
  );

  let lastKnownConsentState = "";
  let lastKnownDiagState = "";
  let pollingInterval = false;
  let maxPollingAttempts = 100000;
  let currentAttemptForCoMo = 0;

  function sendConsentDataToBackground() {
    const googleTagDataEntriesObj = window.google_tag_data.ics.entries;
    const knownConsentSettings = [
      "ad_storage",
      "ad_user_data",
      "ad_personalization",
      "analytics_storage",
      "functionality_storage",
      "personalization_storage",
      "security_storage",
    ];
    const message = {};
    const data = {};
    let consentModeEnabledToSend = false;

    for (const setting of knownConsentSettings) {
      const currentEntry = googleTagDataEntriesObj[setting];
      const defaultConsentValue = getSettingValue(currentEntry, "default");
      const updateConsentValue = getSettingValue(currentEntry, "update");

      data[setting] = {
        default: defaultConsentValue,
        update: updateConsentValue,
      };

      if (defaultConsentValue !== "notSet" || updateConsentValue !== "notSet") {
        consentModeEnabledToSend = true;
      }
    }

    message.data = data;

    message.check = {
      usedDefault: window.google_tag_data.ics.usedDefault,
      usedUpdate: window.google_tag_data.ics.usedUpdate,
      waitPeriodTimedOut: window.google_tag_data.ics.waitPeriodTimedOut,
      wasSetLate: window.google_tag_data.ics.wasSetLate,
    };

    if (consentModeEnabledToSend) {
      console.log("UniConsent - Consent Mode Loaded");

      window.postMessage(
        {
          from: "uniconsent-checker",
          subject: "consentmode",
          body: message,
        },
        "*"
      );
    }
  }

  function collectDiagnostics() {
    var diag = {
      tcfApiFound: typeof window.__tcfapi === "function" || !!window.__tcfapiLocator,
      gppApiFound: typeof window.__gpp === "function" || !!window.__gppLocator,
      cmpDetected: !!window.__unicapi,
      gtagDataFound: !!window.google_tag_data,
      gcmActive: !!(window.google_tag_data && window.google_tag_data.ics && window.google_tag_data.ics.active),
      gtagLoaded: false,
      gtagConsentDefaultExists: false,
      gtagConsentDefaultOrder: true,
      adsActive: false,
    };

    if (window.dataLayer) {
      var foundConsentDefault = false;
      for (var i = 0; i < window.dataLayer.length; i++) {
        var item = window.dataLayer[i];
        if (item && item[0] === "config" && item[1] && typeof item[1] === "string" && item[1].indexOf("G-") === 0) {
          diag.gtagLoaded = true;
        }
        if (item && item[0] === "config" && item[1] && typeof item[1] === "string" && item[1].indexOf("AW-") === 0) {
          diag.adsActive = true;
        }
        if (item && item[0] === "consent" && item[1] === "default") {
          diag.gtagConsentDefaultExists = true;
          foundConsentDefault = true;
        }
        if (item && item.event === "gtm.load" && !foundConsentDefault) {
          diag.gtagConsentDefaultOrder = false;
        }
      }
    }

    if (window.google_tag_data && window.google_tag_data.tidr && window.google_tag_data.tidr.container) {
      var containers = Object.keys(window.google_tag_data.tidr.container);
      for (var j = 0; j < containers.length; j++) {
        if (containers[j].indexOf("AW-") === 0) {
          diag.adsActive = true;
          break;
        }
      }
    }

    return diag;
  }

  function sendDiagnosticsIfChanged() {
    var diag = collectDiagnostics();
    var diagStr = JSON.stringify(diag);
    if (diagStr !== lastKnownDiagState) {
      lastKnownDiagState = diagStr;
      window.postMessage(
        {
          from: "uniconsent-checker",
          subject: "diagnostics",
          body: diag,
        },
        "*",
      );
    }
  }

  function checkAndSendConsentData() {
    currentAttemptForCoMo++;

    if (currentAttemptForCoMo >= maxPollingAttempts) {
      clearInterval(pollingInterval);
      return;
    }

    // Always update diagnostics on each poll tick
    sendDiagnosticsIfChanged();

    if (
      window.google_tag_data &&
      window.google_tag_data.ics &&
      window.google_tag_data.ics.entries
    ) {
      if (
        JSON.stringify(window.google_tag_data.ics.entries) !==
        lastKnownConsentState
      ) {
        lastKnownConsentState = JSON.stringify(
          window.google_tag_data.ics.entries
        );
        sendConsentDataToBackground();
      }
    }
  }

  function startPolling() {
    if (!pollingInterval) {
      checkAndSendConsentData();
      pollingInterval = setInterval(() => {
        checkAndSendConsentData();
      }, 500);
    }
  }

  startPolling();
})();

function getSettingValue(currentEntryFromGoogleObj, key) {
  return currentEntryFromGoogleObj?.[key] !== undefined
    ? currentEntryFromGoogleObj[key].toString()
    : "notSet";
}

function domReady() {
  typeof window.__tcfapi === "function" &&
    window.__tcfapi("addEventListener", 2, (tcData, success) => {
      if (success && tcData.eventStatus === "tcloaded") {
        window.postMessage(
          {
            from: "uniconsent-checker",
            subject: "tcf",
            body: tcData,
          },
          "*"
        );
      }
    });

  typeof window.__gpp === "function" &&
    window.__gpp("addEventListener", (data, success) => {
      if (success) {
        window.postMessage(
          {
            from: "uniconsent-checker",
            subject: "gpp",
            body: data.pingData,
          },
          "*"
        );
      }
    });
}

function pollingTcfData() {
  const checkInterval = 1000;
  const maxLoopsAfterWindowLoaded = 60;
  let loopsAfterWindowLoaded = 0;

  typeof window.__tcfapi === "function" &&
    window.__tcfapi("getTCData", 2, (tcData, success) => {
      if (success && tcData.eventStatus === "tcloaded") {
        loopsAfterWindowLoaded = 70;
        window.postMessage(
          {
            from: "uniconsent-checker",
            subject: "tcf",
            body: tcData,
          },
          "*"
        );
      }
    });

  function checkTcfVariable() {
    const interval = setInterval(() => {
      if (++loopsAfterWindowLoaded >= maxLoopsAfterWindowLoaded) {
        clearInterval(interval);
        return;
      }
      typeof window.__tcfapi === "function" &&
        window.__tcfapi("getTCData", 2, (tcData, success) => {
          if (success && (tcData.eventStatus === "tcloaded" || tcData.eventStatus === "useractioncomplete")) {
            clearInterval(interval);
            window.postMessage(
              {
                from: "uniconsent-checker",
                subject: "tcf",
                body: tcData,
              },
              "*"
            );
          }
        });
    }, checkInterval);
  }
  checkTcfVariable();
}

function pollingGppData() {
  const checkInterval = 1000;
  const maxLoopsAfterWindowLoaded = 60;
  let loopsAfterWindowLoaded = 0;

  typeof window.__gpp === "function" &&
    window.__gpp("ping", (data, success) => {
      if (success) {
        window.postMessage(
          {
            from: "uniconsent-checker",
            subject: "gpp",
            body: data,
          },
          "*"
        );
      }
    });

  function checkGppVariable() {
    const interval = setInterval(() => {
      if (++loopsAfterWindowLoaded >= maxLoopsAfterWindowLoaded) {
        clearInterval(interval);
        return;
      }
      typeof window.__gpp === "function" &&
        window.__gpp("ping", (data, success) => {
          if (success && data.signalStatus === "ready") {
            clearInterval(interval);
            window.postMessage(
              {
                from: "uniconsent-checker",
                subject: "gpp",
                body: data,
              },
              "*"
            );
          }
        });
    }, checkInterval);
  }
  checkGppVariable();
}

function pollingUETData() {
  const checkInterval = 1000;
  const maxLoopsAfterWindowLoaded = 60;
  let loopsAfterWindowLoaded = 0;

  function formatUETData(arr) {
    let uet = { ad_storage: "" };

    if (Object.prototype.toString.call(arr) === "[object Object]") {
      uet.ad_storage = arr.uetConfig?.consent?.adStorageAllowed
        ? "granted"
        : "denied";

      return uet;
    } else if (
      Object.prototype.toString.call(arr) === "[object Array]" &&
      arr.length > 0
    ) {
      arr.forEach((item) => {
        if (item?.ad_storage) {
          uet.ad_storage = item.ad_storage;
        }
      });
      return uet;
    }
  }

  function getUetDatas() {
    if (!window.uetq) {
      return;
    }
    const originalPush = window.uetq.push;

    window.uetq.push = function () {
      const args = Array.from(arguments);
      originalPush.apply(this, args);

      window.postMessage(
        {
          from: "uniconsent-checker",
          subject: "uet",
          body: formatUETData(window.uetq),
        },
        "*"
      );
      return;
    };
  }

  if (window.uetq) {
    loopsAfterWindowLoaded = 70;

    getUetDatas();
    //send uet data
    window.postMessage(
      {
        from: "uniconsent-checker",
        subject: "uet",
        body: formatUETData(window.uetq),
      },
      "*"
    );
  }

  function checkUetVariable() {
    const interval = setInterval(() => {
      if (++loopsAfterWindowLoaded >= maxLoopsAfterWindowLoaded) {
        clearInterval(interval);
        return;
      }
      getUetDatas();

      clearInterval(interval);
      window.postMessage(
        {
          from: "uniconsent-checker",
          subject: "uet",
          body: formatUETData(window.uetq),
        },
        "*"
      );
    }, checkInterval);
  }

  checkUetVariable();
}

function getConsentData() {
  function domReady() {
    pollingTcfData();
    pollingGppData();
    pollingUETData();
  }

  if (
    document.readyState === "interactive" ||
    document.readyState === "complete"
  ) {
    domReady();
  } else {
    document.addEventListener("DOMContentLoaded", domReady);
  }
}

setTimeout(() => getConsentData(), 1000);
