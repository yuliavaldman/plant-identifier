const PlantDocConfig = (() => {
  const isNative = typeof window !== 'undefined'
    && typeof window.Capacitor !== 'undefined'
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();

  return {
    API_BASE_URL: isNative ? 'https://plant-identifier-85gk.onrender.com' : '',
    IS_NATIVE: !!isNative
  };
})();
