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
const sectorShortLabelByName = new Map([
  ['Finance and Insurance', 'Finance'],
  ['Government', 'Government'],
  ['Health Care and Social Assistance', 'Health care'],
  ['Information', 'Information'],
  ['Manufacturing', 'Manufacturing'],
  ['Professional, Scientific, and Technical Services', 'Prof. services'],
  ['Real Estate and Rental and Leasing', 'Real estate'],
  ['Retail Trade', 'Retail'],
  ['Wholesale Trade', 'Wholesale'],
]);
const sectorDisplayMeta = dataset.sectors.map((sector) => ({
  ...sector,
  shortLabel: sectorShortLabelByName.get(sector.name) || sector.name,
}));
const sectorStatsByModel = buildSectorStatsByModel();

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

function formatPoints(value) {
  return `${(Number(value) * 100).toFixed(1)} pts`;
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

function median(values) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

function scoreMeaningSentence() {
  return 'Wins means the AI was judged better than the human expert. Wins+T includes cases where the AI matched the human.';
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

function buildSectorStatsByModel() {
  const output = new Map();

  for (const model of visibleModels) {
    const sectorRows = sectorDisplayMeta.map((sectorMeta) => {
      const rows = dataset.occupationScores
        .filter((row) => row.modelId === model.modelId && row.sector === sectorMeta.name && !row.hidden)
        .sort((a, b) => Number(a.winOrTieRate) - Number(b.winOrTieRate) || a.occupation.localeCompare(b.occupation));
      if (!rows.length) {
        return {
          ...sectorMeta,
          occupationCount: 0,
          minWinOrTieRate: 0,
          medianWinOrTieRate: 0,
          maxWinOrTieRate: 0,
          meanWinOrTieRate: 0,
          overallWinOrTieRate: Number(model.overallWinOrTieRate || 0),
          deltaMedianVsOverall: 0,
          spread: 0,
          weakest: null,
          strongest: null,
        };
      }

      const rates = rows.map((row) => Number(row.winOrTieRate || 0));
      const minWinOrTieRate = rates[0];
      const maxWinOrTieRate = rates[rates.length - 1];
      const medianWinOrTieRate = median(rates);
      const meanWinOrTieRate = mean(rates);
      const overallWinOrTieRate = Number(model.overallWinOrTieRate || 0);

      return {
        ...sectorMeta,
        occupationCount: rows.length,
        minWinOrTieRate,
        medianWinOrTieRate,
        maxWinOrTieRate,
        meanWinOrTieRate,
        overallWinOrTieRate,
        deltaMedianVsOverall: medianWinOrTieRate - overallWinOrTieRate,
        spread: maxWinOrTieRate - minWinOrTieRate,
        weakest: rows[0],
        strongest: rows[rows.length - 1],
      };
    }).filter((row) => row.occupationCount > 0);

    output.set(model.modelId, sectorRows);
  }

  return output;
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

function modelSectorSummary(modelId) {
  const rows = sectorStatsByModel.get(modelId) || [];
  const model = modelById.get(modelId);
  if (!rows.length || !model) {
    return {
      meanDeviation: 0,
      widest: null,
      highestMedian: null,
      lowestMedian: null,
      overall: Number(model?.overallWinOrTieRate || 0),
    };
  }

  const sortedByMedian = [...rows].sort((a, b) => b.medianWinOrTieRate - a.medianWinOrTieRate);
  const sortedBySpread = [...rows].sort((a, b) => b.spread - a.spread);
  return {
    meanDeviation: mean(rows.map((row) => Math.abs(row.medianWinOrTieRate - Number(model.overallWinOrTieRate || 0)))),
    widest: sortedBySpread[0],
    highestMedian: sortedByMedian[0],
    lowestMedian: sortedByMedian[sortedByMedian.length - 1],
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
    jaggedness: `${dataset.sectors.length} sector spreads`,
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
        <h2>Sector spread using all subfields</h2>
        <p class="lede">Each sector below uses all of its underlying GDPval subfields. The dot is the median subfield Wins+T for the selected model, and the vertical stem shows the weakest-to-strongest subfield average inside that sector.</p>
        <div class="badge-row">
          ${models.map((model) => `<span class="badge soft">${esc(model.label)}</span>`).join('')}
          <span class="badge good">all 44 subfields included</span>
        </div>
      </div>
    </div>
    <div class="focus-stats">
      <div class="mini-stat">
        <div class="stat-label">Sectors</div>
        <strong>${dataset.sectors.length}</strong>
        <div class="note">actual GDPval sectors</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Subfields</div>
        <strong>${occupationRecords.length}</strong>
        <div class="note">included in the spread</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Signal</div>
        <strong>Low · Median · High</strong>
        <div class="note">within-sector subfield range</div>
      </div>
      <div class="mini-stat">
        <div class="stat-label">Baseline</div>
        <strong>Overall Wins+T</strong>
        <div class="note">dashed reference line</div>
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
      <p class="note panel-subnote">${esc(scoreMeaningSentence())}</p>
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
      <p class="note panel-subnote">This leaderboard is benchmark-wide. It does not change with sector or subfield selection. ${esc(scoreMeaningSentence())}</p>
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
  return sectorStatsByModel.get(modelId) || [];
}

function renderJaggednessChart(models) {
  const series = models.map((model, index) => ({
    model,
    color: comparePalette[index % comparePalette.length],
    rows: jaggednessSeries(model.modelId),
    summary: modelSectorSummary(model.modelId),
  }));
  const sectorsInChart = sectorDisplayMeta.filter((sector) => series.some((item) => item.rows.some((row) => row.name === sector.name)));
  const values = series.flatMap((item) => item.rows.flatMap((row) => [
    row.minWinOrTieRate,
    row.medianWinOrTieRate,
    row.maxWinOrTieRate,
  ]))
    .concat(series.map((item) => Number(item.model.overallWinOrTieRate || 0)));
  const minValue = values.length ? Math.max(0, Math.floor((Math.min(...values) - 0.03) * 20) / 20) : 0;
  const maxValue = values.length ? Math.min(1, Math.ceil((Math.max(...values) + 0.03) * 20) / 20) : 1;
  const range = Math.max(maxValue - minValue, 0.12);
  const width = 920;
  const height = 360;
  const margin = { top: 24, right: 30, bottom: 82, left: 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xFor = (index) => margin.left + (innerWidth * index) / Math.max(sectorsInChart.length - 1, 1);
  const yFor = (value) => margin.top + innerHeight - ((value - minValue) / range) * innerHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => maxValue - (range * index) / 4);
  const offsets = models.length === 1
    ? [0]
    : models.map((_, index) => (index === 0 ? -16 : 16));

  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Model comparison</p>
          <h3>Median line with sector range</h3>
        </div>
        <span class="badge soft">${models.length === 1 ? 'single profile' : 'side by side'}</span>
      </div>
      <div class="jagged-toolbar">
        ${renderJaggednessSelect('jagged-primary', 'Primary model', state.comparePrimary, visibleModels)}
        ${renderJaggednessSelect('jagged-secondary', 'Comparison model (optional)', state.compareSecondary, visibleModels.filter((model) => model.modelId !== state.comparePrimary), { allowEmpty: true })}
      </div>
      <p class="note panel-subnote">Every sector uses its full set of subfields. The dot marks the sector median, the stem spans the weakest to strongest subfield average, and the dashed line is the model's overall GDPval Wins+T. Here, 50% means the model matched or beat the human deliverable in about half of the subfield comparisons inside that sector.</p>
      <div class="chart-legend">
        ${series.map((item) => `
          <div class="legend-chip">
            <span class="legend-swatch" style="--swatch:${item.color};"></span>
            <div>
              <strong>${esc(item.model.label)}</strong>
              <div class="note">Overall ${formatPercent(item.summary.overall)} · mean median deviation ${formatPoints(item.summary.meanDeviation)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="jagged-chart-shell">
        <svg class="jagged-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Median and range of sector performance across subfields">
          ${ticks.map((tick) => `
            <g>
              <line x1="${margin.left}" y1="${yFor(tick)}" x2="${width - margin.right}" y2="${yFor(tick)}" stroke="#d8d1c2" stroke-width="1" />
              <text x="${margin.left - 12}" y="${yFor(tick) + 4}" text-anchor="end" fill="#5f695f" font-size="12">${esc(formatPercent(tick))}</text>
            </g>
          `).join('')}
          ${series.map((item) => `
            <g>
              <line x1="${margin.left}" y1="${yFor(item.summary.overall)}" x2="${width - margin.right}" y2="${yFor(item.summary.overall)}" stroke="${item.color}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 6" />
              ${item.rows.length ? `<path d="M ${sectorsInChart.map((sector, index) => {
    const row = item.rows.find((entry) => entry.name === sector.name);
    return row ? `${xFor(index) + offsets[series.indexOf(item)]} ${yFor(row.medianWinOrTieRate)}` : '';
  }).filter(Boolean).join(' L ')}" fill="none" stroke="${item.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
              ${sectorsInChart.map((sector, index) => {
    const row = item.rows.find((entry) => entry.name === sector.name);
    if (!row) return '';
    const x = xFor(index) + offsets[series.indexOf(item)];
    const yMin = yFor(row.minWinOrTieRate);
    const yMedian = yFor(row.medianWinOrTieRate);
    const yMax = yFor(row.maxWinOrTieRate);
    return `
                <g>
                  <line x1="${x}" y1="${yMax}" x2="${x}" y2="${yMin}" stroke="${item.color}" stroke-opacity="0.7" stroke-width="4" stroke-linecap="round" />
                  <line x1="${x - 6}" y1="${yMax}" x2="${x + 6}" y2="${yMax}" stroke="${item.color}" stroke-width="2" stroke-linecap="round" />
                  <line x1="${x - 6}" y1="${yMin}" x2="${x + 6}" y2="${yMin}" stroke="${item.color}" stroke-width="2" stroke-linecap="round" />
                  <circle cx="${x}" cy="${yMedian}" r="6" fill="${item.color}" />
                  <circle cx="${x}" cy="${yMedian}" r="11" fill="${item.color}" fill-opacity="0.14" />
                </g>
              `;
  }).join('')}
            </g>
          `).join('')}
          ${sectorsInChart.map((sector, index) => `
            <g>
              <line x1="${xFor(index)}" y1="${margin.top}" x2="${xFor(index)}" y2="${height - margin.bottom + 8}" stroke="rgba(185, 173, 152, 0.35)" stroke-width="1" />
              <text x="${xFor(index)}" y="${height - 24}" text-anchor="middle" fill="#1d2429" font-size="13" font-weight="600">${esc(sector.shortLabel)}</text>
              <text x="${xFor(index)}" y="${height - 8}" text-anchor="middle" fill="#5f695f" font-size="11">${formatInteger(sector.occupationCount || 0)} subfields</text>
            </g>
          `).join('')}
        </svg>
      </div>
      <p class="note">Sharp jumps in the median line indicate cross-sector specialization. Wide stems indicate that the sector itself contains both easy and hard subfields for that model.</p>
    </article>
  `;
}

function renderJaggednessTable(models) {
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Breakdown</p>
          <h3>Sector min, median, and max</h3>
        </div>
      </div>
      <p class="note panel-subnote">Each value is an occupation-level Wins+T average inside that sector. Median cells also show the difference from the model's overall GDPval Wins+T.</p>
      <div class="table-wrap">
        <table class="data-table jagged-table">
          <thead>
            <tr>
              <th rowspan="2">Sector</th>
              <th rowspan="2">Subfields</th>
              ${models.map((model) => `
                <th colspan="4">${esc(model.label)}</th>
              `).join('')}
            </tr>
            <tr>
              ${models.map(() => `
                <th>Low</th>
                <th>Median</th>
                <th>High</th>
                <th>Span</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${sectorDisplayMeta.map((sector) => `
              <tr>
                <td class="sector-cell"><strong>${esc(sector.name)}</strong></td>
                <td>${formatInteger(sector.occupationCount || 0)}</td>
                ${models.map((model) => {
                  const row = jaggednessSeries(model.modelId).find((item) => item.name === sector.name);
                  return `
                    <td class="numeric-cell">${row ? formatPercent(row.minWinOrTieRate) : 'N/A'}</td>
                    <td class="numeric-cell">${row ? `${formatPercent(row.medianWinOrTieRate)}<span class="note median-note">${formatDelta(row.deltaMedianVsOverall)}</span>` : 'N/A'}</td>
                    <td class="numeric-cell">${row ? formatPercent(row.maxWinOrTieRate) : 'N/A'}</td>
                    <td class="numeric-cell">${row ? `<span class="badge ${row.spread <= 0.22 ? 'good' : row.spread <= 0.38 ? 'soft' : 'warn'}">${formatPoints(row.spread)}</span>` : 'N/A'}</td>
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

function renderJaggednessView() {
  const models = selectedCompareModels();
  return `
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
      <p class="empty-copy">Each sector uses every public GDPval subfield inside that sector. The line follows the median subfield result, while the stem shows the weakest to strongest subfield average.</p>
    </div>
    <div class="preview-stack">
      <div class="preview-box">
        <div class="preview-head">
          <strong>Interpretation guide</strong>
          <span class="badge soft">lower = steadier</span>
        </div>
        <div class="note">Use three signals together: the median line across sectors, the within-sector stem width, and the gap between each sector median and the model's overall baseline. This now uses the real GDPval sectors rather than bundled macro groups.</div>
      </div>
      ${models.map((model, index) => {
        const summary = modelSectorSummary(model.modelId);
        const occupationSummary = modelOccupationSummary(model.modelId);
        return `
          <div class="metric-card">
            <div class="preview-head">
              <strong>${esc(model.label)}</strong>
              <span class="legend-chip compact">
                <span class="legend-swatch" style="--swatch:${comparePalette[index % comparePalette.length]};"></span>
                <span class="note">overall ${formatPercent(summary.overall)} · mean sector deviation ${formatPoints(summary.meanDeviation)}</span>
              </span>
            </div>
            <div class="metric-grid">
              <div class="metric-cell">
                <div class="key-label">Highest sector median</div>
                <div>${summary.highestMedian ? `${esc(summary.highestMedian.shortLabel)} · ${formatPercent(summary.highestMedian.medianWinOrTieRate)}` : 'N/A'}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Lowest sector median</div>
                <div>${summary.lowestMedian ? `${esc(summary.lowestMedian.shortLabel)} · ${formatPercent(summary.lowestMedian.medianWinOrTieRate)}` : 'N/A'}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Widest sector span</div>
                <div>${summary.widest ? `${esc(summary.widest.shortLabel)} · ${formatPoints(summary.widest.spread)}` : 'N/A'}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Best subfield</div>
                <div>${occupationSummary.best ? `${esc(occupationSummary.best.occupation)} · ${formatPercent(occupationSummary.best.winOrTieRate)}` : 'N/A'}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Weakest subfield</div>
                <div>${occupationSummary.weakest ? `${esc(occupationSummary.weakest.occupation)} · ${formatPercent(occupationSummary.weakest.winOrTieRate)}` : 'N/A'}</div>
              </div>
              <div class="metric-cell">
                <div class="key-label">Best-vs-worst subfield</div>
                <div class="metric-value">${formatPoints(occupationSummary.spread)}</div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
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
