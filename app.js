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

const state = {
  sector: 'All sectors',
  occupation: dataset.summary.defaultOccupation,
  search: '',
  view: 'overview',
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
  { id: 'models', label: 'Models' },
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
    overview: 'Summary',
    tasks: `${currentTasks().length} tasks`,
    files: `${currentFiles().length} files`,
    models: `${currentScores().length} rows`,
  };
  refs.viewSwitch.innerHTML = viewTabs.map((tab) => `
    <button class="switch-pill ${state.view === tab.id ? 'is-active' : ''}" data-action="select-view" data-view="${tab.id}">
      <strong>${esc(tab.label)}</strong>
      <span class="note">${esc(counts[tab.id])}</span>
    </button>
  `).join('');
}

function renderFocusCard() {
  const occupation = currentOccupationRecord();
  const scores = currentScores();
  const topModel = scores[0];
  const files = currentFiles();
  const previewable = files.filter((file) => file.previewAvailable).length;
  refs.focusCard.innerHTML =     `
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
          <div class="note">${formatBytes(file.size)} · ${file.hasLocal ? 'source file available' : 'source file unavailable'}</div>
          <div class="inline-actions">
            <button class="small-button" data-action="open-file" data-file-id="${file.id}">Inspect</button>
            <a href="${fileHref(file.localPath)}" target="_blank" rel="noreferrer">Open source file</a>

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
              <th>Local</th>
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
                  <td>${file.hasLocal ? 'Yes' : 'No'}</td>
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
  const scores = currentScores();
  const max = Math.max(...scores.map((row) => row.winOrTieRate), 0.001);
  return `
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Models</p>
          <h3>Leaderboard</h3>
        </div>
        <span class="badge soft">${scores.length} rows</span>
      </div>
      <div class="bar-stack">
        ${scores.map((row) => `
          <div class="bar-row">
            <div class="row-head">
              <strong>${esc(row.label)}</strong>
              <span class="note">Rank ${row.rankWinOrTie} here · overall rank ${row.overallRank}</span>
            </div>
            <div class="track">
              <span class="fill-base" style="width:${(row.winOrTieRate / max) * 100}%"></span>
              <span class="fill-strong" style="width:${(row.winRate / max) * 100}%"></span>
            </div>
            <div class="badge-row" style="margin-top:8px;">
              <span class="badge soft">${formatPercent(row.winRate)} wins</span>
              <span class="badge soft">${formatPercent(row.winOrTieRate)} wins+t</span>
              <span class="badge ${row.deltaWinOrTieRate >= 0 ? 'good' : 'warn'}">${formatDelta(row.deltaWinOrTieRate)}</span>
              ${row.hidden ? '<span class="badge warn">hidden row</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </article>
    <article class="panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Model table</p>
          <h3>Occupation versus overall</h3>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Wins</th>
              <th>Wins+T</th>
              <th>Overall Wins+T</th>
              <th>Delta</th>
              <th>Overall Rank</th>
            </tr>
          </thead>
          <tbody>
            ${scores.map((row) => `
              <tr>
                <td>${row.rankWinOrTie}</td>
                <td><strong>${esc(row.label)}</strong>${row.hidden ? '<div class="note">hidden row</div>' : ''}</td>
                <td>${formatPercent(row.winRate)}</td>
                <td>${formatPercent(row.winOrTieRate)}</td>
                <td>${formatPercent(row.overallWinOrTieRate)}</td>
                <td>${formatDelta(row.deltaWinOrTieRate)}</td>
                <td>${row.overallRank}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
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

function renderPreviewPanel() {
  const file = selectedFile();
  if (!file) {
    refs.previewPanel.innerHTML = `
      <div class="preview-empty">
        <div>
          <p class="preview-kicker">Preview</p>
          <h3>No file selected</h3>
          <p class="empty-copy">Pick a file from Tasks or Files to inspect extracted text, tables, metadata, and open-file links.</p>
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
            <a href="${fileHref(file.localPath)}" target="_blank" rel="noreferrer">Open source file</a>

            ${task ? `<a href="${esc(task.viewerUrl)}" target="_blank" rel="noreferrer">Open task row</a>` : ''}
          </div>
        </div>
        <div class="key-grid">
          <div><div class="key-label">Source URL</div><div>${esc(file.localPath || '-')}</div></div>
          <div><div class="key-label">Source Path</div><div>${esc(file.path || payload?.sourcePath || '-')}</div></div>
          <div><div class="key-label">HF URI</div><div>${esc(file.hfUri || '-')}</div></div>
          <div><div class="key-label">Preview JSON</div><div>${esc(entry?.jsonPath || '-')}</div></div>
        </div>
      </div>
    `;
  } else {
    body = `
      <div class="preview-stack">
        <div class="preview-box">
          <div class="note">${esc(payload?.summary || 'No extracted summary is available for this file.')}</div>
          ${entry && !entry.supportsInline ? '<div class="note" style="margin-top:8px;">Public-safe build: inline extraction is disabled. Use Open File for the official source document.</div>' : ''}
        </div>
        <div class="key-grid">
          <div><div class="key-label">Type</div><div>${esc(file.fileType.toUpperCase())}</div></div>
          <div><div class="key-label">Role</div><div>${esc(file.kind)}</div></div>
          <div><div class="key-label">Size</div><div>${formatBytes(file.size)}</div></div>
          <div><div class="key-label">Inline Preview</div><div>${entry?.supportsInline ? 'Yes' : 'No'}</div></div>
          <div><div class="key-label">Task</div><div>${task ? esc(shortText(task.promptPreview, 72)) : 'Unavailable'}</div></div>
          <div><div class="key-label">Source</div><div>${file.hasLocal ? 'Present' : 'Missing'}</div></div>
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
  renderViewSwitch();
  renderFocusCard();
  renderViewContent();
  renderPreviewPanel();
}

function ensurePreviewLoaded(fileId) {
  if (previewPayload(fileId)) return Promise.resolve(previewPayload(fileId));
  const entry = previewEntry(fileId);
  if (!entry?.scriptPath) {
    return Promise.reject(new Error('Preview manifest entry is missing.'));
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



