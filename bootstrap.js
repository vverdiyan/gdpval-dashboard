(async function bootstrapGDPvalGithub() {
  const base = window.GDPVAL_GITHUB_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const isFileMode = window.location.protocol === 'file:';
  const datasetUrl = new URL(params.get('dataset') || base.datasetUrl || './data/dataset.json', window.location.href).href;
  const manifestUrl = new URL(params.get('manifest') || base.previewManifestUrl || './data/preview-manifest.json', window.location.href).href;
  const previewBase = new URL(params.get('previewBase') || base.previewBaseUrl || './data/previews/', window.location.href).href;
  const localDatasetScript = new URL('./data/dataset.js', window.location.href).href;
  const localManifestScript = new URL('./data/preview-manifest.js', window.location.href).href;

  function bootError(message, detail) {
    document.body.innerHTML = `
      <main style="padding:32px;font-family:Segoe UI,sans-serif;max-width:900px;margin:0 auto;">
        <h1 style="margin:0 0 12px;">GDPval Dashboard</h1>
        <p style="margin:0 0 16px;line-height:1.5;">${message}</p>
        <pre style="white-space:pre-wrap;background:#f6f4ee;border:1px solid #d9d1c2;border-radius:12px;padding:16px;">${detail}</pre>
      </main>`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Script load failed: ' + src));
      document.head.appendChild(script);
    });
  }

  function normalizeAssets(dataset, manifest) {
    for (const file of dataset.attachments || []) {
      file.localPath = file.url || file.localPath;
      file.hasLocal = Boolean(file.url || file.localPath);
    }

    for (const entry of Object.values(manifest.byId || {})) {
      entry.scriptPath = new URL(`${entry.id}.js`, previewBase).href;
      entry.jsonPath = new URL(`${entry.id}.json`, previewBase).href;
    }
  }

  try {
    if (isFileMode) {
      await loadScript(localDatasetScript);
      await loadScript(localManifestScript);
      if (!window.GDPVAL_DATASET || !window.GDPVAL_PREVIEW_MANIFEST) {
        throw new Error('Local dataset scripts loaded, but GDPval globals were not defined.');
      }
      normalizeAssets(window.GDPVAL_DATASET, window.GDPVAL_PREVIEW_MANIFEST);
      window.__GDPVAL_PREVIEWS = window.__GDPVAL_PREVIEWS || {};
      await loadScript('./app.js');
      return;
    }

    const [dataset, manifest] = await Promise.all([
      fetch(datasetUrl, { cache: 'no-store' }).then((res) => {
        if (!res.ok) throw new Error(`Dataset request failed: ${res.status} ${res.statusText}`);
        return res.json();
      }),
      fetch(manifestUrl, { cache: 'no-store' }).then((res) => {
        if (!res.ok) throw new Error(`Manifest request failed: ${res.status} ${res.statusText}`);
        return res.json();
      }),
    ]);

    normalizeAssets(dataset, manifest);
    window.GDPVAL_DATASET = dataset;
    window.GDPVAL_PREVIEW_MANIFEST = manifest;
    window.__GDPVAL_PREVIEWS = window.__GDPVAL_PREVIEWS || {};
    await loadScript('./app.js');
  } catch (error) {
    bootError(
      isFileMode
        ? 'The GitHub build could not load its local GDPval assets from file mode.'
        : 'The GitHub build could not load its web data sources.',
      String(error && error.message ? error.message : error),
    );
  }
})();
