window.addEventListener("message", function (event) {
  if (event.source !== window) {
    return;
  }
  var message = event.data;
  if (
    typeof message !== "object" ||
    message === null ||
    message.from !== "uniconsent-checker"
  ) {
    return;
  }
  chrome.runtime.sendMessage(message);
});
