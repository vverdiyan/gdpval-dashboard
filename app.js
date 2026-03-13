const dataset = window.GDPVAL_DATASET;
const previewManifest = window.GDPVAL_PREVIEW_MANIFEST || { byId: {} };
window.__GDPVAL_PREVIEWS = window.__GDPVAL_PREVIEWS || {};

if (!dataset) {
  document.body.innerHTML = '<main style="padding:32px;font-family:sans-serif">GDPval V5 assets are missing.</main>';
  throw new Error('GDPval V5 assets are missing.');
}

const refs = {
  sectorSelect: document.getElementById('sector-select'),
  occupationSelect: document.getElementById('occupation-select'),
  occupationSearch: document.getElementById('occupation-search'),
  viewSwitch: document.getElementById('view-switch'),
  focusCard: document.getElementById('focus-card'),
  viewContent: document.getElementById('view-content'),
  previewPanel: document.getElementById('preview-panel'),
};

const visibleModels = dataset.models.filter((model) => !model.hidden);
const defaultPrimaryModelId = visibleModels.find((model) => model.label === 'GPT-5.2')?.modelId || visibleModels[0]?.modelId || '';
const defaultSecondaryModelId = visibleModels.find((model) => model.label === 'Claude Opus 4.5')?.modelId
  || visibleModels.find((model) => model.modelId !== defaultPrimaryModelId)?.modelId
  || '';

const state = {
  sector: 'All sectors',
  occupation: dataset.summary.defaultOccupation,
  search: '',
  view: 'overview',
  comparePrimary: defaultPrimaryModelId,
  compareSecondary: defaultSecondaryModelId,
  selectedTaskId: null,
  selectedAttachmentId: null,
  previewTab: 'overview',
  previewLoading: false,
  previewError: '',
};

const decoder = document.createElement('textarea');
const previewPromises = new Map();
const viewTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'files', label: 'Files' },
  { id: 'jaggedness', label: 'Jaggedness' },
  { id: 'models', label: 'Leaderboard' },
];
const previewTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'tables', label: 'Tables' },
  { id: 'text', label: 'Text' },
  { id: 'open', label: 'Open File' },
];
const sectors = ['All sectors', ...dataset.sectors.map((sector) => sector.name)];
const occupationRecords = dataset.occupations.map((occupation) => ({
  ...occupation,
  key: occupationKey(occupation.sector, occupation.name),
}));
const tasksByOccupation = groupBy(dataset.tasks, (task) => occupationKey(task.sector, task.occupation));
const filesByOccupation = groupBy(dataset.attachments, (file) => occupationKey(file.sector, file.occupation));
const scoresByOccupation = groupBy(dataset.occupationScores, (row) => occupationKey(row.sector, row.occupation));
const filesByTask = groupBy(dataset.attachments, (file) => file.taskId);
const tasksById = new Map(dataset.tasks.map((task) => [task.taskId, task]));
const filesById = new Map(dataset.attachments.map((file) => [file.id, file]));
const occupationMetaByKey = new Map(occupationRecords.map((occupation) => [occupation.key, occupation]));
const modelById = new Map(dataset.models.map((model) => [model.modelId, model]));
const comparePalette = ['#1f5c63', '#9a6d2f'];
const macroGroups = [
  {
    id: 'finance-business',
    label: 'Finance & Business Services',
    shortLabel: 'Finance & Biz',
    sectors: ['Finance and Insurance', 'Professional, Scientific, and Technical Services'],
  },
  {
    id: 'public',
    label: 'Public Sector',
    shortLabel: 'Public',
    sectors: ['Government'],
  },
  {
    id: 'health',
    label: 'Health & Care',
    shortLabel: 'Health',
    sectors: ['Health Care and Social Assistance'],
  },
  {
    id: 'information',
    label: 'Information',
    shortLabel: 'Info',
    sectors: ['Information'],
  },
  {
    id: 'industry',
    label: 'Industry & Supply Chain',
    shortLabel: 'Industry',
    sectors: ['Manufacturing', 'Wholesale Trade'],
  },
  {
    id: 'commerce-property',
    label: 'Commerce & Property',
    shortLabel: 'Commerce',
    sectors: ['Retail Trade', 'Real Estate and Rental and Leasing'],
  },
];
const macroGroupBySector = new Map(
  macroGroups.flatMap((group) => group.sectors.map((sector) => [sector, group.id])),
);
const macroGroupMeta = macroGroups.map((group) => {
  const occupations = occupationRecords.filter((occupation) => group.sectors.includes(occupation.sector));
  return {
    ...group,
    taskCount: occupations.reduce((sum, occupation) => sum + Number(occupation.taskCount || 0), 0),
    occupationCount: occupations.length,
  };
});
const macroGroupMetaById = new Map(macroGroupMeta.map((group) => [group.id, group]));
const macroScoresByModel = buildMacroScoresByModel();
const macroTopPerformance = buildMacroTopPerformance();

function occupationKey(sector, occupation) {
  return `${sector}||${occupation}`;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatDelta(value) {
  const points = Number(value) * 100;
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)} pts`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = Number(value);
  let idx = 0;
  while (amount >= 1024 && idx < units.length - 1) {
    amount /= 1024;
    idx += 1;
  }
  return `${amount.toFixed(amount >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function shortText(value, length = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function fileHref(relativePath) {
  const value = String(relativePath || '');
  return /^[a-z]+:\/\//i.test(value) ? value : value.split('/').map(encodeURIComponent).join('/');
}

function fileName(file) {
  return String(file?.basename || file?.path || file?.localPath || '').split('/').pop() || 'File';
}

function cleanCell(value) {
  const raw = String(value ?? '');
  const noTags = raw.replace(/<[^>]+>/g, ' ');
  decoder.innerHTML = noTags;
  return decoder.value.replace(/\s+/g, ' ').trim();
}

function verificationChecks() {
  return dataset.verification?.checks || [];
}

function verificationPassed() {
  return verificationChecks().filter((check) => check.passed).length;
}

function formatVerifiedAt() {
  const value = dataset.verification?.verifiedAt;
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function occupationsBySector() {
  return occupationRecords.filter((occupation) => state.sector === 'All sectors' || occupation.sector === state.sector);
}

function visibleOccupations() {
  const bySector = occupationsBySector();
  if (!state.search) return bySector;
  return bySector.filter((occupation) => `${occupation.name} ${occupation.sector}`.toLowerCase().includes(state.search));
}

function currentOccupationRecord() {
  return occupationRecords.find((occupation) => occupation.name === state.occupation) || occupationRecords[0];
}

function currentScores() {
  const occupation = currentOccupationRecord();
  return [...(scoresByOccupation.get(occupation.key) || [])].sort((a, b) => b.winOrTieRate - a.winOrTieRate || b.winRate - a.winRate);
}

function currentTasks() {
  const occupation = currentOccupationRecord();
  return tasksByOccupation.get(occupation.key) || [];
}

function currentFiles() {
  const occupation = currentOccupationRecord();
  return [...(filesByOccupation.get(occupation.key) || [])].sort((a, b) => {
    if (Number(b.previewAvailable) !== Number(a.previewAvailable)) return Number(b.previewAvailable) - Number(a.previewAvailable);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return fileName(a).localeCompare(fileName(b));
  });
}

function currentTask() {
  const tasks = currentTasks();
  return tasks.find((task) => task.taskId === state.selectedTaskId) || tasks[0] || null;
}

function selectedFile() {
  return state.selectedAttachmentId ? filesById.get(state.selectedAttachmentId) || null : null;
}

function previewEntry(fileId) {
  return previewManifest?.byId?.[fileId] || null;
}

function previewPayload(fileId) {
  return window.__GDPVAL_PREVIEWS[fileId] || null;
}

function buildMacroScoresByModel() {
  const output = new Map();

  for (const model of visibleModels) {
    const buckets = macroGroups.map((group) => ({
      ...macroGroupMetaById.get(group.id),
      winTotal: 0,
      winOrTieTotal: 0,
      weight: 0,
      winRate: 0,
      winOrTieRate: 0,
      overallWinOrTieRate: Number(model.overallWinOrTieRate || 0),
      deltaWinOrTieRate: 0,
    }));
    const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));

    for (const row of dataset.occupationScores) {
      if (row.modelId !== model.modelId) continue;
      const groupId = macroGroupBySector.get(row.sector);
      if (!groupId) continue;
      const bucket = bucketById.get(groupId);
      const weight = Number(occupationMetaByKey.get(occupationKey(row.sector, row.occupation))?.taskCount || 1);
      bucket.weight += weight;
      bucket.winTotal += Number(row.winRate) * weight;
      bucket.winOrTieTotal += Number(row.winOrTieRate) * weight;
    }

    for (const bucket of buckets) {
      bucket.winRate = bucket.weight ? bucket.winTotal / bucket.weight : 0;
      bucket.winOrTieRate = bucket.weight ? bucket.winOrTieTotal / bucket.weight : 0;
      bucket.deltaWinOrTieRate = bucket.winOrTieRate - bucket.overallWinOrTieRate;
    }

    output.set(model.modelId, buckets);
  }

  return output;
}

function buildMacroTopPerformance() {
  return macroGroupMeta.map((group) => {
    const rows = visibleModels.map((model) => {
      const macroRow = (macroScoresByModel.get(model.modelId) || []).find((row) => row.id === group.id && row.weight > 0);
      return macroRow ? { ...macroRow, label: model.label } : null;
    }).filter(Boolean);

    const topWin = rows.reduce((best, row) => (Number(row.winRate) > Number(best?.winRate || -1) ? row : best), null);
    const topWinOrTie = rows.reduce((best, row) => (Number(row.winOrTieRate) > Number(best?.winOrTieRate || -1) ? row : best), null);

    return {
      ...group,
      topWinRate: Number(topWin?.winRate || 0),
      topWinLabel: topWin?.label || 'N/A',
      topWinOrTieRate: Number(topWinOrTie?.winOrTieRate || 0),
      topWinOrTieLabel: topWinOrTie?.label || 'N/A',
      ceilingGap: Number(topWinOrTie?.winOrTieRate || 0) - Number(topWin?.winRate || 0),
    };
  });
}

function modelOccupationSummary(modelId) {
  const rows = dataset.occupationScores
    .filter((row) => row.modelId === modelId && !row.hidden)
    .sort((a, b) => b.winOrTieRate - a.winOrTieRate || b.winRate - a.winRate);

  if (!rows.length) {
    return {
      spread: 0,
      best: null,
      weakest: null,
    };
  }

  const best = rows[0];
  const weakest = rows[rows.length - 1];
  return {
    spread: Number(best.winOrTieRate || 0) - Number(weakest.winOrTieRate || 0),
    best,
    weakest,
  };
}

function compareModel(modelId) {
  return modelById.get(modelId) || visibleModels[0] || null;
}

function selectedCompareModels() {
  const primary = compareModel(state.comparePrimary);
  const secondary = state.compareSecondary && state.compareSecondary !== primary?.modelId
    ? compareModel(state.compareSecondary)
    : null;
  return [primary, secondary].filter(Boolean);
}

function modelMacroSummary(modelId) {
  const rows = (macroScoresByModel.get(modelId) || []).filter((row) => row.weight > 0);
  const model = modelById.get(modelId);
  if (!rows.length || !model) {
    return {
      spread: 0,
      jaggedness: 0,
      best: null,
      weakest: null,
      overall: Number(model?.overallWinOrTieRate || 0),
    };
  }

  const sorted = [...rows].sort((a, b) => b.winOrTieRate - a.winOrTieRate);
  const best = sorted[0];
  const weakest = sorted[sorted.length - 1];
  return {
    spread: best.winOrTieRate - weakest.winOrTieRate,
    jaggedness: mean(rows.map((row) => Math.abs(row.winOrTieRate - Number(model.overallWinOrTieRate || 0)))),
    best,
    weakest,
    overall: Number(model.overallWinOrTieRate || 0),
  };
}

function syncState() {
  const bySector = occupationsBySector();
  const visible = visibleOccupations();
  const pool = visible.length ? visible : bySector.length ? bySector : occupationRecords;

  if (!pool.some((occupation) => occupation.name === state.occupation)) {
    state.occupation = pool[0]?.name || dataset.summary.defaultOccupation;
  }

  const tasks = currentTasks();
  if (!tasks.some((task) => task.taskId === state.selectedTaskId)) {
    state.selectedTaskId = tasks[0]?.taskId || null;
  }

  const files = currentFiles();
  if (!files.some((file) => file.id === state.selectedAttachmentId)) {
    state.selectedAttachmentId = null;
    state.previewTab = 'overview';
    state.previewLoading = false;
    state.previewError = '';
  }

  if (!visibleModels.some((model) => model.modelId === state.comparePrimary)) {
    state.comparePrimary = defaultPrimaryModelId;
  }

  if (state.compareSecondary && !visibleModels.some((model) => model.modelId === state.compareSecondary)) {
    state.compareSecondary = defaultSecondaryModelId;
  }

  if (state.compareSecondary && state.compareSecondary === state.comparePrimary) {
    state.compareSecondary = visibleModels.find((model) => model.modelId !== state.comparePrimary)?.modelId || '';
  }
}

function renderSectorSelect() {
  refs.sectorSelect.innerHTML = sectors.map((sectorName) => `<option value="${esc(sectorName)}" ${state.sector === sectorName ? 'selected' : ''}>${esc(sectorName)}</option>`).join('');
}

function renderOccupationSelect() {
  const visible = visibleOccupations();
  const fallback = occupationsBySector();
  const options = visible.length ? visible : fallback;
  refs.occupationSelect.innerHTML = options.length
    ? options.map((occupation) => `<option value="${esc(occupation.name)}" ${state.occupation === occupation.name ? 'selected' : ''}>${esc(occupation.name)}${state.search && !visible.length ? ' (closest sector match)' : ''}</option>`).join('')
    : '<option value="">No matching subfield</option>';
  refs.occupationSelect.disabled = !options.length;
}

function renderViewSwitch() {
  const counts = {
    overview: 'Key takeaways',
    tasks: `${currentTasks().length} public tasks`,
    files: `${currentFiles().length} linked files`,
    jaggedness: 'Cross-field spread',
    models: `${visibleModels.length} overall models`,
  };
  refs.viewSwitch.innerHTML = viewTabs.map((tab) => `
    <button class="switch-pill ${state.view === tab.id ? 'is-active' : ''}" data-action="select-view" data-view="${tab.id}">
      <strong>${esc(tab.label)}</strong>
      <span class="note">${esc(counts[tab.id])}</span>
    </button>
  `).join('');
}

function renderOccupationFocusCard() {
  const occupation = currentOccupationRecord();
  const scores = currentScores();
  const topModel = scores[0];
  const files = currentFiles();
  const previewable = files.filter((file) => file.previewAvailable).length;
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Subfield</p>
        <h2>${esc(occupation.name)}</h2>
        <p class="lede">${esc(occupation.sector)}. Web-loaded GDPval snapshot with source files on Hugging Face.</p>
        <div class="badge-row">
          <span class="badge soft">${esc(occupation.sector)}</span>
          ${occupation.isInvestor ? '<span class="badge good">Investor subset</span>' : ''}
          ${topModel ? `<span class="badge good">Top model: ${esc(topModel.label)}</span>` : '<span class="badge warn">No model score rows</span>'}
        </div>
      </div>
    </div>
    <div class="focus-stats">
      <div class="mini-stat">
        <div class="stat-label">Tasks</div>
        <strong>${occupation.taskCount}</strong>
        <div class="note">exact task rows</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Files</div>
        <strong>${occupation.attachmentCount}</strong>
        <div class="note">public attachments</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Open only</div>
        <strong>${Math.max(files.length - previewable, 0)}</strong>
        <div class="note">official source links</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Top Wins+T</div>
        <strong>${topModel ? formatPercent(topModel.winOrTieRate) : 'N/A'}</strong>
        <div class="note">occupation-level score</div>
      </div>
    </div>
  `;
}

function renderJaggednessFocusCard() {
  const models = selectedCompareModels();
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Jaggedness</p>
        <h2>Consistency across major work domains</h2>
        <p class="lede">Choose one or two models to see whether performance stays steady across work domains or spikes in a few. GDPval's 9 sectors are compressed into 6 macro groups so the pattern stays readable.</p>
        <div class="badge-row">
          ${models.map((model) => `<span class="badge soft">${esc(model.label)}</span>`).join('')}
          <span class="badge good">lower deviation = steadier</span>
        </div>
      </div>
    </div>
    <div class="focus-stats">
      <div class="mini-stat">
        <div class="stat-label">Groups</div>
        <strong>${macroGroups.length}</strong>
        <div class="note">from 9 sectors</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Subfields</div>
        <strong>${occupationRecords.length}</strong>
        <div class="note">all public occupations</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Tasks</div>
        <strong>${formatInteger(dataset.tasks.length)}</strong>
        <div class="note">weighted into each group</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Reading</div>
        <strong>Solid vs dashed</strong>
        <div class="note">group score vs overall baseline</div>
      </div>
    </div>
  `;
}

function renderLeaderboardFocusCard() {
  const scores = [...visibleModels].sort((a, b) => a.overallRank - b.overallRank || b.overallWinOrTieRate - a.overallWinOrTieRate);
  const topModel = scores[0];
  return `
    <div class="focus-top">
      <div>
        <p class="section-kicker">Leaderboard</p>
        <h2>Overall GDPval results</h2>
        <p class="lede">The official model ranking across the public GDPval benchmark. This view is benchmark-wide and does not depend on the selected sector or subfield.</p>
        <div class="badge-row">
          <span class="badge soft">Official benchmark-wide view</span>
          ${topModel ? `<span class="badge good">Top model: ${esc(topModel.label)}</span>` : ``}
        </div>
      </div>
    </div>
    <div class="focus-stats">
      <div class="mini-stat">
        <div class="stat-label">Models</div>
        <strong>${scores.length}</strong>
        <div class="note">official leaderboard rows</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Tasks</div>
        <strong>${formatInteger(dataset.tasks.length)}</strong>
        <div class="note">public task rows</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Top Wins+T</div>
        <strong>${topModel ? formatPercent(topModel.overallWinOrTieRate) : `N/A`}</strong>
        <div class="note">best overall model result</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Source</div>
        <strong>OpenAI</strong>
        <div class="note">official leaderboard and public files</div>
      </div>
    </div>
  `;
}

function renderFocusCard() {
  refs.focusCard.innerHTML = state.view === 'jaggedness'
    ? renderJaggednessFocusCard()
    : state.view === 'models'
      ? renderLeaderboardFocusCard()
      : renderOccupationFocusCard();
}

function renderTaskTable(tasks, actionLabel = 'Open detail', action = 'go-task') {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Rubric</th>
            <th>Points</th>
            <th>Files</th>
            <th>Inline</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map((task) => `
            <tr class="${state.selectedTaskId === task.taskId ? 'is-selected' : ''}">
              <td>
                <strong>${esc(shortText(task.promptPreview, 122))}</strong>
                <div class="task-preview">${esc(task.promptPreview)}</div>
              </td>
              <td>${task.rubricCount}</td>
              <td>${task.positivePoints}</td>
              <td>${task.attachmentCount}</td>
              <td>${task.previewableAttachmentCount}</td>
              <td><button class="table-button" data-action="${action}" data-task-id="${task.taskId}">${esc(actionLabel)}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function renderPerformancePanel(scores) {
  const rows = scores.slice(0, 8);
  const max = Math.max(...rows.map((row) => row.winOrTieRate), 0.001);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Performance</p>
          <h3>Wins and wins+t</h3>
        </div>
        <span class="badge soft">${scores.length} models</span>
      </div>
      <div class="bar-stack">
        ${rows.map((row) => `
          <div class="bar-row">
            <div class="row-head">
              <strong>${esc(row.label)}</strong>
              <span class="note">${formatPercent(row.winRate)} wins · ${formatPercent(row.winOrTieRate)} wins+t</span>
            </div>
            <div class="track">
              <span class="fill-base" style="width:${(row.winOrTieRate / max) * 100}%"></span>
              <span class="fill-strong" style="width:${(row.winRate / max) * 100}%"></span>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderDeltaPanel(scores) {
  const rows = scores.slice(0, 8);
  const max = Math.max(...rows.map((row) => Math.abs(row.deltaWinOrTieRate)), 0.001);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Delta</p>
          <h3>Versus overall</h3>
        </div>
        <span class="badge soft">occupation minus overall</span>
      </div>
      <div class="bar-stack">
        ${rows.map((row) => `
          <div class="bar-row">
            <div class="row-head">
              <strong>${esc(row.label)}</strong>
              <span class="note">${formatDelta(row.deltaWinOrTieRate)}</span>
            </div>
            <div class="track">
              <span class="${row.deltaWinOrTieRate >= 0 ? 'fill-positive' : 'fill-negative'}" style="width:${(Math.abs(row.deltaWinOrTieRate) / max) * 100}%"></span>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderAttachmentPanel(files) {
  const grouped = [...groupBy(files, (file) => file.fileType || 'unknown').entries()]
    .map(([type, rows]) => ({ type, total: rows.length, inline: rows.filter((row) => row.previewAvailable).length }))
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
  const max = Math.max(...grouped.map((row) => row.total), 1);
  return     `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Files</p>
          <h3>File types</h3>
        </div>
        <span class="badge soft">${files.length} files</span>
      </div>
      <div class="type-stack">
        ${grouped.map((row) => `
          <div class="type-row">
            <strong>${esc(row.type.toUpperCase())}</strong>
            <div class="type-track">
              <span class="type-base" style="width:${(row.total / max) * 100}%"></span>
              <span class="type-inline" style="width:${(row.inline / max) * 100}%"></span>
            </div>
            <span class="note">${row.inline} / ${row.total}</span>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-copy">No files are indexed for this occupation.</div></div>'}
      </div>
    </article>
  `;
}

function renderVerificationPanel() {
  const checks = verificationChecks();
  return     `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Checks</p>
          <h3>Dataset and files</h3>
        </div>
        <span class="badge good">${verificationPassed()}/${checks.length}</span>
      </div>
      <p class="note panel-subnote">Verified ${esc(formatVerifiedAt())}. Counts match the published public snapshot used by this dashboard.</p>
      <div class="check-stack">
        ${checks.map((check) => `
          <div class="check-row compact">
            <div class="row-head compact">
              <strong>${esc(check.label)}</strong>
              <div class="row-tail">
                <span class="note">${esc(check.actual)} actual · ${esc(check.expected)} expected</span>
                ${check.passed ? '' : '<span class="badge alert">Mismatch</span>'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderTaskFiles(task) {
  const files = [...(filesByTask.get(task.taskId) || [])].sort((a, b) => {
    if (Number(b.previewAvailable) !== Number(a.previewAvailable)) return Number(b.previewAvailable) - Number(a.previewAvailable);
    return fileName(a).localeCompare(fileName(b));
  });
  if (!files.length) {
    return '<div class="empty-state"><div class="empty-copy">This task has no public files attached.</div></div>';
  }
  return `
    <div class="list-stack">
      ${files.map((file) => `
        <div class="file-row">
          <div class="row-head">
            <strong>${esc(fileName(file))}</strong>
            <div class="badge-row">
              <span class="badge soft">${esc(file.fileType.toUpperCase())}</span>
              <span class="badge ${file.kind === 'reference' ? 'soft' : 'warn'}">${esc(file.kind)}</span>
              <span class="badge ${file.previewAvailable ? 'good' : 'warn'}">${file.previewAvailable ? 'inline' : 'open only'}</span>
            </div>
          </div>
          <div class="note">${formatBytes(file.size)} · official file link</div>
          <div class="inline-actions">
            <button class="small-button" data-action="open-file" data-file-id="${file.id}">Inspect</button>
            <a href="${esc(file.url)}" target="_blank" rel="noreferrer">Open source</a>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOverviewView() {
  const tasks = currentTasks();
  const files = currentFiles();
  const scores = currentScores();
  return     `
    <div class="panel-grid two">
      ${renderPerformancePanel(scores)}
      ${renderDeltaPanel(scores)}
    </div>
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Tasks</p>
          <h3>Public task rows</h3>
        </div>
        <span class="badge soft">${tasks.length} tasks</span>
      </div>
      ${renderTaskTable(tasks)}
    </article>
    <div class="panel-grid two">
      ${renderAttachmentPanel(files)}
      ${renderVerificationPanel()}
    </div>
  `;
}

function renderTasksView() {
  const tasks = currentTasks();
  const task = currentTask();
  return     `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Tasks</p>
          <h3>All task rows</h3>
        </div>
        <span class="badge soft">${tasks.length} rows</span>
      </div>
      ${renderTaskTable(tasks, 'Select task', 'select-task')}
    </article>
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Task detail</p>
          <h3>${task ? esc(shortText(task.promptPreview, 110)) : 'No task selected'}</h3>
        </div>
        ${task ? `<a href="${esc(task.viewerUrl)}" target="_blank" rel="noreferrer">Open task row</a>` : ''}
      </div>
      ${task ? `
        <div class="badge-row">
          <span class="badge soft">${task.rubricCount} rubric items</span>
          <span class="badge soft">${task.positivePoints} positive points</span>
          <span class="badge soft">${task.attachmentCount} files</span>
          <span class="badge soft">${task.previewableAttachmentCount} inline</span>
        </div>
        <div class="detail-grid">
          <div>
            <h3>Prompt</h3>
            <div class="long-text">${esc(task.prompt)}</div>
          </div>
          <div>
            <h3>Rubric</h3>
            <div class="long-text">${esc(task.rubricPretty)}</div>
          </div>
        </div>
        <div>
          <h3>Files</h3>
          ${renderTaskFiles(task)}
        </div>
      ` : '<div class="empty-state"><div class="empty-copy">No task is available for this filter.</div></div>'}
    </article>
  `;
}
function renderFilesView() {
  const files = currentFiles();
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Files</p>
          <h3>Public file inventory</h3>
        </div>
        <div class="badge-row">
          <span class="badge soft">${files.length} files</span>
          <span class="badge soft">${files.filter((file) => file.kind === 'reference').length} reference</span>
          <span class="badge soft">${files.filter((file) => file.kind === 'deliverable').length} deliverable</span>
          <span class="badge ${files.some((file) => file.previewAvailable) ? 'good' : 'warn'}">${files.filter((file) => file.previewAvailable).length} inline</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Role</th>
              <th>Task Rubric</th>
              <th>Size</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${files.map((file) => {
              const task = tasksById.get(file.taskId);
              return `
                <tr class="${state.selectedAttachmentId === file.id ? 'is-selected' : ''}">
                  <td>
                    <strong>${esc(fileName(file))}</strong>
                    <div class="task-preview">${esc(shortText(task?.promptPreview || 'Task unavailable', 112))}</div>
                  </td>
                  <td>${esc(file.fileType.toUpperCase())}</td>
                  <td>${esc(file.kind)}</td>
                  <td>${task ? task.rubricCount : '-'}</td>
                  <td>${formatBytes(file.size)}</td>
                  <td><a href="${esc(file.url)}" target="_blank" rel="noreferrer">Open</a></td>
                  <td><button class="table-button" data-action="open-file" data-file-id="${file.id}">Inspect</button></td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="7">No files are indexed for this occupation.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderModelsView() {
  const scores = [...visibleModels].sort((a, b) => a.overallRank - b.overallRank || b.overallWinOrTieRate - a.overallWinOrTieRate);
  const max = Math.max(...scores.map((row) => row.overallWinOrTieRate), 0.001);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Official leaderboard</p>
          <h3>Overall benchmark ranking</h3>
        </div>
        <span class="badge soft">${scores.length} models</span>
      </div>
      <p class="note panel-subnote">This leaderboard is benchmark-wide. It does not change with sector or subfield selection.</p>
      <div class="bar-stack">
        ${scores.map((row) => `
          <div class="bar-row">
            <div class="row-head">
              <strong>#${row.overallRank} ${esc(row.label)}</strong>
              <span class="note">${esc(row.provider || 'provider unknown')}</span>
            </div>
            <div class="track">
              <span class="fill-base" style="width:${(row.overallWinOrTieRate / max) * 100}%"></span>
              <span class="fill-strong" style="width:${(row.overallWinRate / max) * 100}%"></span>
            </div>
            <div class="badge-row" style="margin-top:8px;">
              <span class="badge soft">${formatPercent(row.overallWinRate)} wins</span>
              <span class="badge soft">${formatPercent(row.overallWinOrTieRate)} wins+t</span>
            </div>
          </div>
        `).join('')}
      </div>
    </article>
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Model table</p>
          <h3>Official overall results</h3>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Provider</th>
              <th>Wins</th>
              <th>Wins+T</th>
            </tr>
          </thead>
          <tbody>
            ${scores.map((row) => `
              <tr>
                <td>${row.overallRank}</td>
                <td><strong>${esc(row.label)}</strong>${row.hidden ? '<div class="note">hidden row</div>' : ''}</td>
                <td>${esc(row.provider || '-')}</td>
                <td>${formatPercent(row.overallWinRate)}</td>
                <td>${formatPercent(row.overallWinOrTieRate)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderJaggednessSelect(id, label, selectedId, options, { allowEmpty = false } = {}) {
  return `
    <label class="compare-field">
      <span class="field-label">${esc(label)}</span>
      <select id="${esc(id)}">
        ${allowEmpty ? '<option value="">None</option>' : ''}
        ${options.map((model) => `<option value="${esc(model.modelId)}" ${selectedId === model.modelId ? 'selected' : ''}>${esc(model.label)}</option>`).join('')}
      </select>
    </label>
  `;
}

function jaggednessSeries(modelId) {
  return (macroScoresByModel.get(modelId) || []).filter((row) => row.weight > 0);
}

function renderJaggednessChart(models) {
  const series = models.map((model, index) => ({
    model,
    color: comparePalette[index % comparePalette.length],
    rows: jaggednessSeries(model.modelId),
    summary: modelMacroSummary(model.modelId),
  }));
  const values = series.flatMap((item) => item.rows.map((row) => row.winOrTieRate))
    .concat(series.map((item) => Number(item.model.overallWinOrTieRate || 0)));
  const minValue = values.length ? Math.max(0, Math.floor((Math.min(...values) - 0.03) * 20) / 20) : 0;
  const maxValue = values.length ? Math.min(1, Math.ceil((Math.max(...values) + 0.03) * 20) / 20) : 1;
  const range = Math.max(maxValue - minValue, 0.12);
  const width = 780;
  const height = 320;
  const margin = { top: 24, right: 30, bottom: 64, left: 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xFor = (index) => margin.left + (innerWidth * index) / Math.max(macroGroups.length - 1, 1);
  const yFor = (value) => margin.top + innerHeight - ((value - minValue) / range) * innerHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => maxValue - (range * index) / 4);

  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Model comparison</p>
          <h3>Grouped wins+t profile</h3>
        </div>
        <span class="badge soft">${models.length === 1 ? 'single profile' : 'side by side'}</span>
      </div>
      <div class="jagged-toolbar">
        ${renderJaggednessSelect('jagged-primary', 'Primary model', state.comparePrimary, visibleModels)}
        ${renderJaggednessSelect('jagged-secondary', 'Comparison model (optional)', state.compareSecondary, visibleModels.filter((model) => model.modelId !== state.comparePrimary), { allowEmpty: true })}
      </div>
      <p class="note panel-subnote">Grouped sectors keep the chart readable. Solid lines show wins+t inside each macro group. Dashed lines show each model's own overall GDPval baseline.</p>
      <div class="chart-legend">
        ${series.map((item) => `
          <div class="legend-chip">
            <span class="legend-swatch" style="--swatch:${item.color};"></span>
            <div>
              <strong>${esc(item.model.label)}</strong>
              <div class="note">Overall ${formatPercent(item.summary.overall)} · spread ${formatDelta(item.summary.spread)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="jagged-chart-shell">
        <svg class="jagged-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Wins and ties by grouped sector">
          ${ticks.map((tick) => `
            <g>
              <line x1="${margin.left}" y1="${yFor(tick)}" x2="${width - margin.right}" y2="${yFor(tick)}" stroke="#d8d1c2" stroke-width="1" />
              <text x="${margin.left - 12}" y="${yFor(tick) + 4}" text-anchor="end" fill="#5f695f" font-size="12">${esc(formatPercent(tick))}</text>
            </g>
          `).join('')}
          ${series.map((item) => `
            <g>
              <line x1="${margin.left}" y1="${yFor(item.summary.overall)}" x2="${width - margin.right}" y2="${yFor(item.summary.overall)}" stroke="${item.color}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 6" />
              ${item.rows.length ? `<path d="M ${item.rows.map((row, index) => `${xFor(index)} ${yFor(row.winOrTieRate)}`).join(' L ')}" fill="none" stroke="${item.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
              ${item.rows.map((row, index) => `
                <g>
                  <circle cx="${xFor(index)}" cy="${yFor(row.winOrTieRate)}" r="6" fill="${item.color}" />
                  <circle cx="${xFor(index)}" cy="${yFor(row.winOrTieRate)}" r="11" fill="${item.color}" fill-opacity="0.14" />
                </g>
              `).join('')}
            </g>
          `).join('')}
          ${macroGroups.map((group, index) => `
            <g>
              <line x1="${xFor(index)}" y1="${margin.top}" x2="${xFor(index)}" y2="${height - margin.bottom + 8}" stroke="rgba(185, 173, 152, 0.35)" stroke-width="1" />
              <text x="${xFor(index)}" y="${height - 24}" text-anchor="middle" fill="#1d2429" font-size="13" font-weight="600">${esc(group.shortLabel)}</text>
              <text x="${xFor(index)}" y="${height - 8}" text-anchor="middle" fill="#5f695f" font-size="11">${formatInteger(macroGroupMetaById.get(group.id)?.taskCount || 0)} tasks</text>
            </g>
          `).join('')}
        </svg>
      </div>
      <p class="note">Steeper peaks and dips indicate specialization. Flatter profiles indicate more even performance across work domains.</p>
    </article>
  `;
}

function renderJaggednessTable(models) {
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Breakdown</p>
          <h3>Macro-group table</h3>
        </div>
      </div>
      <p class="note panel-subnote">Positive deltas mean the model is stronger in that macro group than on GDPval overall.</p>
      <div class="table-wrap">
        <table class="data-table jagged-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Included sectors</th>
              <th>Tasks</th>
              ${models.map((model) => `
                <th>${esc(model.label)} Wins+T</th>
                <th>${esc(model.label)} Delta vs overall</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${macroGroups.map((group) => `
              <tr>
                <td><strong>${esc(group.label)}</strong></td>
                <td>${esc(group.sectors.join(' · '))}</td>
                <td>${formatInteger(macroGroupMetaById.get(group.id)?.taskCount || 0)}</td>
                ${models.map((model) => {
                  const row = jaggednessSeries(model.modelId).find((item) => item.id === group.id);
                  return `
                    <td>${row ? formatPercent(row.winOrTieRate) : 'N/A'}</td>
                    <td>${row ? `<span class="badge ${row.deltaWinOrTieRate >= 0 ? 'good' : 'warn'}">${formatDelta(row.deltaWinOrTieRate)}</span>` : 'N/A'}</td>
                  `;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderMacroCeilingPanel() {
  const width = 820;
  const height = 330;
  const margin = { top: 24, right: 18, bottom: 74, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const groupStep = innerWidth / Math.max(macroTopPerformance.length, 1);
  const barGap = 10;
  const barWidth = Math.min(28, Math.max(16, (groupStep - 28) / 2));
  const xForGroup = (index) => margin.left + (groupStep * index) + (groupStep / 2);
  const yFor = (value) => margin.top + innerHeight - (value * innerHeight);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Model-agnostic ceiling</p>
          <h3>Best observed performance by field group</h3>
        </div>
        <span class="badge soft">${macroTopPerformance.length} groups</span>
      </div>
      <p class="note">Field groups run left to right so peaks and dips read like the Jaggedness chart below. Teal shows the highest wins+t reached by any visible model, and amber shows the highest outright-win rate.</p>
      <div class="chart-legend">
        <div class="legend-chip">
          <span class="legend-swatch" style="--swatch:#1f5c63;"></span>
          <div><strong>Top Wins+T</strong></div>
        </div>
        <div class="legend-chip">
          <span class="legend-swatch" style="--swatch:#c78b35;"></span>
          <div><strong>Top Wins</strong></div>
        </div>
      </div>
      <div class="jagged-chart-shell ceiling-chart-shell">
        <svg class="jagged-chart ceiling-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Best wins and wins plus ties by field group">
          <defs>
            <linearGradient id="ceilingWinsTie" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="rgba(31, 92, 99, 0.72)" />
              <stop offset="100%" stop-color="rgba(31, 92, 99, 0.28)" />
            </linearGradient>
            <linearGradient id="ceilingWins" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stop-color="#cf9b4e" />
              <stop offset="100%" stop-color="#e5c48a" />
            </linearGradient>
          </defs>
          ${ticks.map((tick) => `
            <g>
              <line x1="${margin.left}" y1="${yFor(tick)}" x2="${width - margin.right}" y2="${yFor(tick)}" stroke="#d8d1c2" stroke-width="1" />
              <text x="${margin.left - 10}" y="${yFor(tick) + 4}" text-anchor="end" fill="#5f695f" font-size="12">${esc(formatPercent(tick))}</text>
            </g>
          `).join('')}
          ${macroTopPerformance.map((row, index) => {
            const center = xForGroup(index);
            const winsTieHeight = innerHeight - (yFor(row.topWinOrTieRate) - margin.top);
            const winsHeight = innerHeight - (yFor(row.topWinRate) - margin.top);
            return `
              <g>
                <line x1="${center}" y1="${margin.top}" x2="${center}" y2="${height - margin.bottom + 8}" stroke="rgba(185, 173, 152, 0.28)" stroke-width="1" />
                <rect x="${center - barGap / 2 - barWidth}" y="${yFor(row.topWinOrTieRate)}" width="${barWidth}" height="${winsTieHeight}" rx="10" fill="url(#ceilingWinsTie)" />
                <rect x="${center + barGap / 2}" y="${yFor(row.topWinRate)}" width="${barWidth}" height="${winsHeight}" rx="10" fill="url(#ceilingWins)" />
                <text x="${center}" y="${height - 30}" text-anchor="middle" fill="#1d2429" font-size="13" font-weight="600">${esc(macroGroups[index].shortLabel)}</text>
                <text x="${center}" y="${height - 12}" text-anchor="middle" fill="#5f695f" font-size="11">${formatInteger(row.taskCount)} tasks</text>
              </g>
            `;
          }).join('')}
        </svg>
      </div>
    </article>
  `;
}

function renderJaggednessView() {
  const models = selectedCompareModels();
  return `
    ${renderMacroCeilingPanel()}
    ${renderJaggednessChart(models)}
    ${renderJaggednessTable(models)}
  `;
}

function renderViewContent() {
  if (state.view === 'tasks') {
    refs.viewContent.innerHTML = renderTasksView();
    return;
  }
  if (state.view === 'files') {
    refs.viewContent.innerHTML = renderFilesView();
    return;
  }
  if (state.view === 'models') {
    refs.viewContent.innerHTML = renderModelsView();
    return;
  }
  if (state.view === 'jaggedness') {
    refs.viewContent.innerHTML = renderJaggednessView();
    return;
  }
  refs.viewContent.innerHTML = renderOverviewView();
}

function renderPreviewTable(table) {
  const rows = table.rows || [];
  return `
    <div class="preview-box">
      <div class="preview-head">
        <strong>${esc(table.title || 'Table')}</strong>
        <span class="note">${table.totalRows || rows.length} row(s) · ${table.totalCols || (rows[0]?.length || 0)} column(s)</span>
      </div>
      <div class="preview-table-wrap">
        <table class="preview-table">
          <tbody>
            ${rows.map((row, rowIndex) => `
              <tr>
                ${row.map((cell) => rowIndex === 0
                  ? `<th>${esc(cleanCell(cell) || ' ')}</th>`
                  : `<td>${esc(cleanCell(cell) || ' ')}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${table.truncated ? '<div class="note">Preview truncated at build time.</div>' : ''}
    </div>
  `;
}

function renderJaggednessSidebar() {
  const models = selectedCompareModels();
  refs.previewPanel.innerHTML = `
    <div>
      <p class="preview-kicker">Jaggedness</p>
      <h3>How to read this view</h3>
      <p class="empty-copy">Macro spread is the best-vs-worst grouped-domain gap. Subfield spread is the best-vs-worst occupation gap, which shows where a model is most uneven.</p>
    </div>
    <div class="preview-stack">
      <div class="preview-box">
        <div class="preview-head">
          <strong>Interpretation guide</strong>
          <span class="badge soft">lower = steadier</span>
        </div>
        <div class="note">Use the first chart to compare the strongest observed results across grouped domains. Use the second chart to compare the selected models. The cards below show how far each model swings between its best and weakest subfields.</div>
      </div>
      ${models.map((model, index) => {
        const summary = modelMacroSummary(model.modelId);
        const occupationSummary = modelOccupationSummary(model.modelId);
        return `
          <div class="metric-card">
            <div class="preview-head">
              <strong>${esc(model.label)}</strong>
              <span class="legend-chip compact">
                <span class="legend-swatch" style="--swatch:${comparePalette[index % comparePalette.length]};"></span>
                <span class="note">overall ${formatPercent(summary.overall)} · mean deviation ${formatDelta(summary.jaggedness)}</span>
              </span>
            </div>
            <div class="metric-grid">
              <div class="metric-cell">
                <div class="key-label">Macro spread</div>
                <div class="metric-value">${formatDelta(summary.spread)}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Subfield spread</div>
                <div class="metric-value">${formatDelta(occupationSummary.spread)}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Best subfield</div>
                <div>${occupationSummary.best ? `${esc(occupationSummary.best.occupation)} · ${formatPercent(occupationSummary.best.winOrTieRate)}` : 'N/A'}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Weakest subfield</div>
                <div>${occupationSummary.weakest ? `${esc(occupationSummary.weakest.occupation)} · ${formatPercent(occupationSummary.weakest.winOrTieRate)}` : 'N/A'}</div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
      <div class="preview-box">
        <div class="preview-head">
          <strong>How groups were combined</strong>
          <span class="badge soft">${macroGroups.length} macro groups</span>
        </div>
        <div class="group-map">
          ${macroGroupMeta.map((group) => `
            <div class="group-map-item">
              <strong>${esc(group.label)}</strong>
              <div class="note">${formatInteger(group.taskCount)} tasks · ${group.occupationCount} subfields</div>
              <div class="sector-list">
                ${group.sectors.map((sector) => `<span class="badge soft">${esc(sector)}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderPreviewPanel() {
  if (state.view === 'jaggedness') {
    renderJaggednessSidebar();
    return;
  }

  if (state.view === 'models') {
    refs.previewPanel.innerHTML = `
      <div>
        <p class="preview-kicker">Leaderboard</p>
        <h3>Benchmark-wide model ranking</h3>
        <p class="empty-copy">This view is independent of the current sector and subfield. Use the official leaderboard link to cross-check the source ranking.</p>
      </div>
      <div class="preview-stack">
        <div class="preview-box">
          <div class="inline-actions">
            <a href="https://evals.openai.com/gdpval/leaderboard" target="_blank" rel="noreferrer">Open official leaderboard</a>
            <a href="https://huggingface.co/datasets/openai/gdpval" target="_blank" rel="noreferrer">Open Hugging Face dataset</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const file = selectedFile();
  if (!file) {
    refs.previewPanel.innerHTML = `
      <div class="preview-empty">
        <div>
          <p class="preview-kicker">Preview</p>
          <h3>No file selected</h3>
          <p class="empty-copy">Pick a file from Tasks or Files to inspect extracted text, tables, metadata, and the official source links.</p>
        </div>
      </div>
    `;
    return;
  }

  const entry = previewEntry(file.id);
  const payload = previewPayload(file.id);
  const task = tasksById.get(file.taskId);
  const textBlocks = payload?.textBlocks || [];
  const tables = payload?.tables || [];

  let body = '';
  if (state.previewLoading) {
    body = '<div class="empty-state"><div class="empty-copy">Loading preview payload…</div></div>';
  } else if (state.previewError) {
    body = `<div class="empty-state"><div class="empty-copy">${esc(state.previewError)}</div></div>`;
  } else if (state.previewTab === 'tables') {
    body = tables.length ? `<div class="preview-stack">${tables.slice(0, 6).map(renderPreviewTable).join('')}</div>` : '<div class="empty-state"><div class="empty-copy">No extracted tables are available for this file.</div></div>';
  } else if (state.previewTab === 'text') {
    body = textBlocks.length ? `<div class="preview-text-list">${textBlocks.slice(0, 26).map((block) => `<div class="text-block"><strong>${esc(block.label || 'Block')}</strong>${esc(block.text || '')}</div>`).join('')}</div>` : '<div class="empty-state"><div class="empty-copy">No extracted text blocks are available for this file.</div></div>';
  } else if (state.previewTab === 'open') {
    body = `
      <div class="preview-stack">
        <div class="preview-box">
          <div class="inline-actions">
            <a href="${esc(file.url)}" target="_blank" rel="noreferrer">Open source</a>

            ${task ? `<a href="${esc(task.viewerUrl)}" target="_blank" rel="noreferrer">Open task row</a>` : ''}
          </div>
        </div>
        <div class="key-grid">
          <div><div class="key-label">Source URL</div><div><a href="${esc(file.url)}" target="_blank" rel="noreferrer">${esc(file.url || '-')}</a></div></div>
          <div><div class="key-label">Dataset Path</div><div>${esc(file.path || payload?.sourcePath || '-')}</div></div>
          <div><div class="key-label">HF URI</div><div>${esc(file.hfUri || '-')}</div></div>
        </div>
      </div>
    `;
  } else {
    body = `
      <div class="preview-stack">
        <div class="preview-box">
          <div class="note">${esc(payload?.summary || 'No extracted summary is available for this file.')}</div>
          ${entry && !entry.supportsInline ? '<div class="note" style="margin-top:8px;">Inline extraction is unavailable for this file here. Use Open File for the official source document.</div>' : ''}
        </div>
        <div class="key-grid">
          <div><div class="key-label">Type</div><div>${esc(file.fileType.toUpperCase())}</div></div>
          <div><div class="key-label">Role</div><div>${esc(file.kind)}</div></div>
          <div><div class="key-label">Size</div><div>${formatBytes(file.size)}</div></div>
          <div><div class="key-label">Inline Preview</div><div>${entry?.supportsInline ? 'Yes' : 'No'}</div></div>
          <div><div class="key-label">Task</div><div>${task ? esc(shortText(task.promptPreview, 72)) : 'Unavailable'}</div></div>
          <div><div class="key-label">HF URI</div><div>${esc(file.hfUri || '-')}</div></div>
        </div>
        ${textBlocks.length ? `<div class="preview-text-list">${textBlocks.slice(0, 5).map((block) => `<div class="text-block"><strong>${esc(block.label || 'Block')}</strong>${esc(block.text || '')}</div>`).join('')}</div>` : ''}
      </div>
    `;
  }

  refs.previewPanel.innerHTML = `
    <div>
      <p class="preview-kicker">Preview</p>
      <h3>${esc(fileName(file))}</h3>
      <div class="badge-row">
        <span class="badge soft">${esc(file.fileType.toUpperCase())}</span>
        <span class="badge ${file.kind === 'reference' ? 'soft' : 'warn'}">${esc(file.kind)}</span>
        <span class="badge ${entry?.supportsInline ? 'good' : 'warn'}">${entry?.supportsInline ? 'inline preview' : 'open only'}</span>
      </div>
    </div>
    <div class="inline-actions">
      <button class="small-button" data-action="clear-preview">Clear selection</button>
    </div>
    <div class="preview-tab-row">
      ${previewTabs.map((tab) => `<button class="preview-tab ${state.previewTab === tab.id ? 'is-active' : ''}" data-action="preview-tab" data-preview-tab="${tab.id}">${esc(tab.label)}</button>`).join('')}
    </div>
    ${body}
  `;
}
function renderAll() {
  syncState();
  renderSectorSelect();
  renderOccupationSelect();
  const globalView = state.view === 'jaggedness' || state.view === 'models';
  refs.sectorSelect.disabled = globalView;
  refs.occupationSelect.disabled = globalView || refs.occupationSelect.disabled;
  refs.occupationSearch.disabled = globalView;
  refs.occupationSearch.placeholder = state.view === 'jaggedness'
    ? 'Use the model selectors below'
    : state.view === 'models'
      ? 'Leaderboard is benchmark-wide'
      : 'Search occupations';
  renderViewSwitch();
  renderFocusCard();
  renderViewContent();
  renderPreviewPanel();
}

function ensurePreviewLoaded(fileId) {
  if (previewPayload(fileId)) return Promise.resolve(previewPayload(fileId));
  const entry = previewEntry(fileId);
  if (!entry?.supportsInline || !entry?.scriptPath) {
    return Promise.resolve(null);
  }
  if (!previewPromises.has(fileId)) {
    previewPromises.set(fileId, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = entry.scriptPath;
      script.onload = () => resolve(previewPayload(fileId));
      script.onerror = () => reject(new Error('Failed to load preview payload.'));
      document.head.appendChild(script);
    }));
  }
  return previewPromises.get(fileId);
}

async function openFileInPanel(fileId) {
  const file = filesById.get(fileId);
  if (!file) return;
  state.selectedAttachmentId = fileId;
  state.selectedTaskId = file.taskId;
  state.previewTab = 'overview';
  state.previewError = '';
  state.previewLoading = true;
  renderAll();
  try {
    await ensurePreviewLoaded(fileId);
  } catch (error) {
    if (state.selectedAttachmentId === fileId) {
      state.previewError = error.message;
    }
  } finally {
    if (state.selectedAttachmentId === fileId) {
      state.previewLoading = false;
      renderPreviewPanel();
    }
  }
}

refs.sectorSelect.addEventListener('change', (event) => {
  state.sector = event.target.value || 'All sectors';
  state.selectedTaskId = null;
  renderAll();
});

refs.occupationSelect.addEventListener('change', (event) => {
  state.occupation = event.target.value || dataset.summary.defaultOccupation;
  state.selectedTaskId = null;
  renderAll();
});

refs.occupationSearch.addEventListener('input', (event) => {
  state.search = String(event.target.value || '').trim().toLowerCase();
  renderAll();
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;

  if (target.id === 'jagged-primary') {
    state.comparePrimary = target.value || defaultPrimaryModelId;
    if (state.compareSecondary === state.comparePrimary) {
      state.compareSecondary = visibleModels.find((model) => model.modelId !== state.comparePrimary)?.modelId || '';
    }
    renderAll();
    return;
  }

  if (target.id === 'jagged-secondary') {
    state.compareSecondary = target.value && target.value !== state.comparePrimary ? target.value : '';
    renderAll();
  }
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');

  if (action === 'select-view') {
    state.view = target.getAttribute('data-view') || 'overview';
    renderAll();
    return;
  }

  if (action === 'select-task') {
    state.selectedTaskId = target.getAttribute('data-task-id');
    renderAll();
    return;
  }

  if (action === 'go-task') {
    state.selectedTaskId = target.getAttribute('data-task-id');
    state.view = 'tasks';
    renderAll();
    return;
  }

  if (action === 'open-file') {
    void openFileInPanel(target.getAttribute('data-file-id'));
    return;
  }

  if (action === 'preview-tab') {
    state.previewTab = target.getAttribute('data-preview-tab') || 'overview';
    renderPreviewPanel();
    return;
  }

  if (action === 'clear-preview') {
    state.selectedAttachmentId = null;
    state.previewTab = 'overview';
    state.previewLoading = false;
    state.previewError = '';
    renderPreviewPanel();
  }
});

renderAll();



