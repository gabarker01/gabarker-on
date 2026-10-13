// Load a classic script once.
const loading = new Map();

export function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading.delete(src);
        reject(new Error(`Couldn't load ${src}`));
      };
      document.head.appendChild(script);
    }));
  }
  return loading.get(src);
}
