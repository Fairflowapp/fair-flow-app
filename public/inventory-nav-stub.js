(function () {
  window.goToInventory = window.goToInventory || async function ffInvMockStub() {
    if (typeof window.goToInventory === 'function' && window.goToInventory !== ffInvMockStub) {
      return window.goToInventory();
    }
    try {
      await import('/inventory.js?v=20260902_prod_cats');
    } catch (e) {
      console.error('[Inventory mock] load failed', e);
      return;
    }
    if (typeof window.goToInventory === 'function' && window.goToInventory !== ffInvMockStub) {
      return window.goToInventory();
    }
  };
})();
