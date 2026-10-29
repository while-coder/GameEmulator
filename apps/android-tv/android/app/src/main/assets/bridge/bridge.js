// Gecko content scripts run in an isolated world. wrappedJSObject accesses the
// existing page callback without adding any host-specific code to packages/.
if (location.origin === 'http://127.0.0.1:17864') {
  const port = browser.runtime.connectNative('game_emulator');
  port.onMessage.addListener(message => {
    if (message.type !== 'back') return;
    let result = 'handled';
    try {
      const page = window.wrappedJSObject;
      if (typeof page.__handleAndroidBack === 'function') {
        result = page.__handleAndroidBack();
      } else if (location.pathname === '/' || location.pathname === '/index.html') {
        result = 'exit';
      } else {
        location.replace('/index.html');
      }
    } catch (error) {
      console.error('[TV host] Back callback failed', error);
    }
    port.postMessage({ type: 'backResult', id: message.id, result });
  });
}
