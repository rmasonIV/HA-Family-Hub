const CARD = 'family-hub-live';
const MAX_ITEMS = 4;
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const weekOffset = (date, firstDay) => (date.getUTCDay() - firstDay + DAYS.length) % DAYS.length;
const WEATHER_ICONS = new Map(Object.entries({
  sunny:'sunny', clear_night:'night', 'clear-night':'night', partlycloudy:'partly-cloudy',
  cloudy:'cloudy', rainy:'rainy', pouring:'pouring', lightning:'lightning',
  'lightning-rainy':'lightning-rainy', snowy:'snowy', 'snowy-rainy':'snowy-rainy',
  hail:'hail', fog:'fog', windy:'windy', 'windy-variant':'windy-variant', exceptional:'cloud-alert'
}));
function weatherIcon(forecast) {
  const icon = WEATHER_ICONS.get(forecast.condition);
  const condition = typeof forecast.condition === 'string' ? forecast.condition.replace(/[-_]/g, ' ') : 'Forecast';
  return `<ha-icon icon="mdi:${icon ? (icon === 'cloud-alert' ? icon : 'weather-'+icon) : 'thermometer'}"
    title="${escapeText(condition)}" aria-label="${escapeText(condition)}" role="img"></ha-icon>`;
}
const temperaturePosition = (current, high, low) =>
  Number.isFinite(current) && Number.isFinite(high) && Number.isFinite(low) && high >= low
    ? (high === low ? 50 : Math.min(100, Math.max(0, 100 * (high-current)/(high-low))))
    : null;
const ACTION_ICONS = {
  light:'mdi:lightbulb', switch:'mdi:toggle-switch', input_boolean:'mdi:toggle-switch',
  script:'mdi:play-circle-outline', button:'mdi:gesture-tap-button',
  input_button:'mdi:gesture-tap-button', cover:'mdi:garage'
};
const ACTION_ICON_CHOICES = [
  'mdi:lightbulb', 'mdi:lightbulb-on', 'mdi:lamps', 'mdi:floor-lamp', 'mdi:led-strip-variant',
  'mdi:toggle-switch', 'mdi:garage', 'mdi:door', 'mdi:fan', 'mdi:power',
  'mdi:play-circle-outline', 'mdi:gesture-tap-button'
];
const isHexColor = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
const isIcon = icon => typeof icon === 'string' && /^mdi:[a-z0-9-]+$/.test(icon);
const CALENDAR_COLORS = ['#4a90e2','#2ba675','#b47adc','#e68d38','#d96389','#28a8af','#8b9b36','#777fea'];
const calendarColor = (config, id, index) => {
  const color = config.calendar_colors?.[id];
  return isHexColor(color) ? color : CALENDAR_COLORS[index % CALENDAR_COLORS.length];
};
const ACTIONS = {
  light: 'toggle', switch: 'toggle', input_boolean: 'toggle',
  script: 'turn_on', button: 'press', input_button: 'press', cover: 'open_cover'
};
const domainOf = id => typeof id === 'string' ? id.split('.')[0] : '';
const isEntityId = id => typeof id === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const WIDGET_TYPES = new Set(['weather-forecast', 'thermostat', 'gauge', 'tile', 'sensor', 'entities']);

function widgetConfig(entry) {
  if (isEntityId(entry)) {
    const type = {weather:'weather-forecast', climate:'thermostat', sensor:'sensor'}[domainOf(entry)];
    return {type:typeof type === 'string' ? type : 'tile', entity:entry};
  }
  if (!isRecord(entry) || !WIDGET_TYPES.has(entry.type)) return null;
  if (entry.type === 'entities') {
    if (!Array.isArray(entry.entities) || !entry.entities.length) return null;
  } else if (!isEntityId(entry.entity)) return null;
  return entry;
}

function orderedWidgetValue(value) {
  if (Array.isArray(value)) return value.map(orderedWidgetValue);
  if (!isRecord(value)) return value;
  if ('card' in value || 'cards' in value || (typeof value.type === 'string' && /^custom:/i.test(value.type))) {
    throw new Error('Quick Widgets only support built-in cards and rows.');
  }
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, orderedWidgetValue(value[key])]));
}

function normalizeConfig(input, warnings = []) {
  const config = isRecord(input) ? input : {};
  const list = (key, validate, limit = Infinity) => {
    const values = config[key];
    if (values == null) return [];
    if (!Array.isArray(values)) {
      warnings.push(key+' must be a list.');
      return [];
    }
    const seen = new Set();
    const accepted = [];
    let invalid = 0;
    let extra = 0;
    for (const entry of values) {
      const identity = validate(entry);
      if (!identity) {
        invalid++;
      } else if (!seen.has(identity)) {
        seen.add(identity);
        if (accepted.length < limit) accepted.push(entry);
        else extra++;
      }
    }
    if (invalid) warnings.push(`${key}: skipped ${invalid} invalid or unsupported ${invalid === 1 ? 'entry' : 'entries'}.`);
    if (extra) warnings.push(`${key}: only the first ${limit} unique valid entries are shown.`);
    return accepted;
  };
  const option = (key, choices) => {
    const value = config[key];
    if (choices.includes(value)) return value;
    if (value != null) warnings.push(key+' must be '+choices.join(' or ')+'.');
    return choices[0];
  };
  const weather = config.weather_entity;
  const weatherEntity = isEntityId(weather) && domainOf(weather) === 'weather' ? weather : '';
  if (weather != null && weather !== '' && !weatherEntity) warnings.push('weather_entity must be a weather entity.');
  return {
    ...config,
    calendars:list('calendars', id => isEntityId(id) && domainOf(id) === 'calendar' && id),
    actions:list('actions', id => isEntityId(id) && Object.hasOwn(ACTIONS,domainOf(id)) && id, MAX_ITEMS),
    widgets:list('widgets', widgetKey, MAX_ITEMS),
    weather_entity:weatherEntity,
    default_view:option('default_view', ['week','month']),
    week_start:option('week_start', ['monday','sunday']),
    ribbon_default:option('ribbon_default', ['expanded','collapsed']),
    widget_layout:option('widget_layout', ['grid','wide'])
  };
}

function widgetKey(entry) {
  const config = widgetConfig(entry);
  if (!config) return null;
  try {
    return JSON.stringify(orderedWidgetValue(config));
  } catch {
    return null;
  }
}

let cardHelpers;
function loadCardHelpers() {
  cardHelpers ??= Promise.resolve().then(() => window.loadCardHelpers()).catch(error => {
    cardHelpers = undefined;
    throw error;
  });
  return cardHelpers;
}

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[character]);
// Calendar dates are wall dates carried in UTC fields, so day arithmetic is independent of the browser zone.
const addDays = (date, count) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + count));
const monthDate = (date, offset = 0, day = 1) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()+offset, day));
const dateKey = date => date.toISOString().slice(0, 10);
const dateLabel = (date, options) => date.toLocaleDateString(undefined, {...options, timeZone:'UTC'});
function calendarTime(zone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
    });
  } catch {
    return calendarTime(undefined);
  }
  const timeZone = parts.resolvedOptions().timeZone;
  const wallTime = instant => {
    const fields = Object.fromEntries(parts.formatToParts(instant).map(({type,value}) => [type, Number(value)]));
    return Date.UTC(fields.year, fields.month-1, fields.day, fields.hour, fields.minute, fields.second);
  };
  const dayAt = instant => new Date(Math.floor(wallTime(instant)/86400000)*86400000);
  const midnights = new Map();
  const midnight = date => {
    const wall = date.getTime();
    if (midnights.has(wall)) return midnights.get(wall);
    const estimate = 2*wall - wallTime(wall);
    const adjusted = estimate + wall - wallTime(estimate);
    // If a clock change skipped midnight, use the later side of the gap.
    const instant = new Date(adjusted + wall - wallTime(adjusted) === estimate ? Math.max(estimate, adjusted) : adjusted);
    if (midnights.size >= 100) midnights.clear();
    midnights.set(wall, instant);
    return instant;
  };
  const time = new Intl.DateTimeFormat(undefined, {timeZone,hour:'numeric',minute:'2-digit'});
  const datetime = new Intl.DateTimeFormat(undefined, {timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return {dayAt,midnight,when(start,end,date,allDay) {
    if (allDay) return 'All day';
    const format = +dayAt(start) === +date && +dayAt(end) === +date ? time : datetime;
    return format.format(start)+' – '+format.format(end);
  }};
}

const markup = `<style>
:host{font-family:system-ui,sans-serif;color:#223047;background:#f1f4f8}
*{box-sizing:border-box}main{width:100%;padding:clamp(6px,1vw,14px);container-type:inline-size}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
small,.muted{color:#627083}.notice{padding:10px 14px;background:#e6f3ff;border-radius:9px;margin:14px 0}
.layout{display:grid;gap:14px;margin-top:16px}
.quick-actions{background:white;border:1px solid #dce2e9;border-radius:12px}
.quick-header{display:flex;align-items:center;gap:8px;padding:0 10px}
.quick-header button{min-height:44px;border:0;background:transparent;color:inherit}
#quick-toggle{flex:1;text-align:left;font-weight:600}
.action-grid,.widget-grid{display:grid;gap:12px}
.action-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.widget-grid{grid-template-columns:minmax(0,1fr)}
.widget-grid[data-count="2"],.widget-grid[data-count="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.widget-grid[data-count="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
.widget-slot{min-width:0}
.widget-status{margin:0;padding:10px;border:1px solid var(--fh-border);border-radius:9px;overflow-wrap:anywhere}
.action-grid{padding:12px;border-top:1px solid #dce2e9}
.quick-control{display:flex;align-items:center;gap:10px;min-height:64px;padding:10px;border:1px solid #cbd5e1;border-radius:9px;background:#f4f7fb;text-align:left;color:inherit}
.quick-control[aria-pressed="true"]{background:#fff1bf}
.quick-control small,.device strong{display:block}
.toolbar-top{display:flex;align-items:center;justify-content:flex-end;margin:14px 0 8px}
.settings-button,.action-button{border:1px solid #cbd5e1;border-radius:9px;background:white;padding:10px 14px;min-height:44px}
.settings-button{display:flex;align-items:center;gap:8px}
.settings{background:white;border:1px solid #cbd5e1;border-radius:12px;padding:18px;margin:12px 0}
.settings[hidden],.device[hidden],.side[hidden],.action-grid[hidden],.quick-control[hidden]{display:none!important}
.settings-head{display:flex;align-items:center;justify-content:space-between}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.settings fieldset{border:1px solid #dbe2ea;border-radius:9px;padding:14px}
.settings label{display:flex;align-items:center;gap:8px;margin:10px 0}
.settings select{max-width:100%;padding:8px;border-radius:6px}
.settings .helper{font-size:.85rem;color:#627083}

.calendar,.side{background:white;border-radius:12px;padding:clamp(8px,1cqi,14px);box-shadow:0 1px 4px #0001}
.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}
.day{border:1px solid #dce2e9;border-radius:9px;min-height:180px;padding:8px;overflow-wrap:anywhere}
.day,.month-day{box-shadow:0 2px 4px #22304714,0 1px 1px #2230470a}
.day-heading{display:block;width:100%;min-height:44px;margin-bottom:4px;border:0;border-radius:6px;background:transparent;color:inherit;font-weight:700;text-align:center}
.day-heading:hover,.day-heading:focus-visible{background:#eaf1fa}
#week-day-details{width:min(540px,calc(100% - 32px));max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain}
.day-body{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;align-items:start}
.events{text-align:left}
.events .event{padding-inline:4px}
.day-body.events-only{grid-template-columns:minmax(0,1fr)}
.weather{display:grid;justify-items:center;gap:3px;font-size:.75rem;font-variant-numeric:tabular-nums}
.weather-button{border:0;background:transparent;padding:0;width:44px;height:44px;font-size:1.25rem}
.range{position:relative;width:6px;height:42px;border-radius:4px;background:linear-gradient(to top,#3b82f6,#ef4444)}
.weather.horizontal{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}
.weather.horizontal .range{width:48px;height:6px;background:linear-gradient(to right,#ef4444,#3b82f6)}
.weather.horizontal .wide-range{background:linear-gradient(to right,#ef4444,#facc15,#3b82f6)}
.weather.horizontal .current{top:50%;left:var(--position)}
#day-weather:empty{display:none}
.range.wide-range{background:linear-gradient(to top,#3b82f6,#facc15,#ef4444)}
.current[hidden]{display:none}
.quick-control ha-icon{flex:none;--mdc-icon-size:24px}
.current{position:absolute;top:var(--position);left:50%;width:9px;height:9px;transform:translate(-50%,-50%);border:1px solid #304459;border-radius:50%;background:white}
.calendar-header,.month-top,.detail-header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.calendar-header h2,.month-top h3,.detail-header h3{margin:0}
.calendar-header{margin-bottom:12px}
.view-toggle [aria-pressed="true"],.month-day[aria-expanded="true"]{background:#dceafb}
.month-top{margin-bottom:10px}.month-navigation{display:flex;gap:6px}
.month-content{display:grid;gap:12px}
.month-content.has-details{grid-template-columns:minmax(0,1fr) minmax(220px,32%)}
.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.weekday{text-align:center;font-size:.75rem}
.month-day{display:grid;align-content:start;gap:3px;min-width:0;min-height:66px;text-align:left;border:1px solid #dce2e9;border-radius:7px;background:white;padding:5px;color:inherit}
.month-content:not(.has-details) .month-day{min-height:clamp(64px,9dvh,112px)}
.day-details{display:flex;flex-direction:column;min-height:0;contain:size}
.day-details[hidden]{display:none}
#day-events{overflow-y:auto;overscroll-behavior:contain}
.day-event{margin:6px 0;padding:10px}
.day-event p{margin:4px 0;overflow-wrap:anywhere}
.event-meta{display:flex;align-items:baseline;gap:6px}
.event-icon{flex:0 0 1.2em;text-align:center}
.day-event details{margin-top:6px}
.day-event summary{cursor:pointer;min-height:32px}
.day-event summary .description-preview{margin-inline-start:1.2em;color:#4a596b}
.day-event .description-full{margin-inline-start:1.2em}
.description-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.day-event details[open] .description-preview{display:none}
.settings-list{list-style:none;padding:0}
.settings-list li{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}

.month-day .event{padding:3px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.72rem}
.month-day-top{display:flex;justify-content:space-between;align-items:center;gap:1px;width:100%;min-width:0}
.month-day-top ha-icon{--mdc-icon-size:clamp(12px,3cqi,18px);flex:none}
.month-day[aria-current="date"] .month-date{background:var(--primary-color,#4a90e2);color:var(--text-primary-color,#fff);border-radius:6px;padding-inline:2px;font-weight:700}
.day-details{border:1px solid #dce2e9;border-radius:9px;padding:10px;align-self:stretch}
.detail-header h3{font-size:1rem}
dialog{width:min(380px,calc(100% - 32px));border:1px solid #cbd5e1;border-radius:12px;padding:22px;color:inherit}
dialog::backdrop{background:#22304770}
@container (max-width:760px){
  .month-content.has-details{grid-template-columns:minmax(0,1fr)}
  .day-details{contain:none;max-height:360px}
  .month-grid{gap:3px}
  .month-day,.month-content:not(.has-details) .month-day{min-height:52px;padding:4px}
  .month-day .event{font-size:0;min-height:4px;padding:0}
  .month-day small{font-size:.65rem}
}
.event{display:block;background:#dceafb;border-radius:6px;padding:7px;margin:6px 0;font-size:.85rem}
.event.alt{background:#e8f4dc}.event.third{background:#fae8dd}
.side h3{margin-top:0}.device{padding:12px;border:1px solid #e2e6eb;border-radius:9px;margin:10px 0}
button{font:inherit;cursor:pointer}.device button{border:0;border-radius:8px;background:#e4ebf6;padding:8px 12px}
@container (max-width:1050px){.days{grid-template-columns:repeat(4,minmax(0,1fr))}}
@container (max-width:680px){.days{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:460px){.days{grid-template-columns:minmax(0,1fr)}.day{min-height:120px}}

#calendar-status:empty{display:none} button:disabled{cursor:default;opacity:.55}

:host {
  display:block;
  color:var(--primary-text-color,#223047);
  background:transparent;
  --fh-surface:var(--ha-card-background,var(--card-background-color,#fff));
  --fh-border:var(--divider-color,#dce2e9);
  --fh-tint:color-mix(in srgb,var(--primary-color,#4a90e2) 18%,var(--fh-surface));
}
.quick-actions,.calendar,.side,.month-day,.action-button,dialog {
  background:var(--fh-surface);color:inherit;
}
.quick-actions,.month-day,.day,.day-details,.device,.quick-control,.action-button,.action-grid,dialog {
  border-color:var(--fh-border);
}
small,.muted,.day-event summary .description-preview {color:var(--secondary-text-color,#627083)}
.quick-control {background:color-mix(in srgb,currentColor 5%,var(--fh-surface));overflow-wrap:anywhere}
.quick-control[aria-pressed="true"],.view-toggle [aria-pressed="true"],
.month-day[aria-expanded="true"],.day-heading:hover,.day-heading:focus-visible {background:var(--fh-tint)}
.quick-control[data-custom-fill] {
  background:color-mix(in srgb,var(--action-fill) 28%,var(--fh-surface));
}
.month-day[aria-expanded="true"] {border-color:var(--primary-color,#4a90e2)}
.event,.event.alt,.event.third {
  background:color-mix(in srgb,var(--event-color,#4a90e2) 20%,var(--fh-surface));
  border-inline-start:3px solid var(--event-color,#4a90e2);
}
.calendar-legend {display:flex;flex-wrap:wrap;gap:6px 14px;padding:0;margin:0 0 12px;list-style:none;font-size:.85rem}
.calendar-legend[hidden] {display:none}
.calendar-legend button {display:flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:16px;padding:4px 8px;background:transparent;color:inherit;text-align:start}
.calendar-legend button[aria-pressed="true"]{border-color:var(--event-color);background:var(--fh-tint)}
.calendar-legend button::before {content:'';width:10px;height:10px;border-radius:50%;background:var(--event-color)}
@container (max-width:720px) {.widget-grid[data-count="3"]{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:620px) {.action-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:480px) {.widget-grid[data-count]{grid-template-columns:minmax(0,1fr)}}
.widget-grid.wide[data-count]{grid-template-columns:minmax(0,1fr)}
</style><main><p id="config-status" class="muted" role="status" hidden></p><section class="quick-actions" aria-label="Quick Actions" id="quick-actions">
  <div class="quick-header">
    <button type="button" id="quick-toggle" aria-controls="quick-controls" aria-expanded="true">Quick Actions</button>
  </div>
  <div class="action-grid" id="quick-controls"></div></section>
<div class="layout" id="layout">
<section class="calendar" aria-label="Family calendar">
<div class="calendar-header">
  <h2>Family calendar</h2>
  <div class="view-toggle" role="group" aria-label="Calendar view">
    <button class="action-button" id="week-view" type="button" aria-pressed="true">Week</button>
    <button class="action-button" id="month-view" type="button" aria-pressed="false">Month</button>
  </div>
</div>
<p class="muted" id="calendar-status" role="status"></p><ul class="calendar-legend" id="calendar-legend" aria-label="Filter by calendar"></ul><p id="weather-status" class="muted" role="status" hidden></p><div id="week"><div class="days" id="week-days"></div></div>
<div id="month" hidden>
  <div class="month-top">
    <h3 id="month-title"></h3>
    <div class="month-navigation">
      <button class="action-button" id="previous-month" type="button" aria-label="Previous month">‹</button>
      <button class="action-button" id="next-month" type="button" aria-label="Next month">›</button>
    </div>
  </div>
  <div class="month-content" id="month-content">
    <div class="month-grid" id="month-grid" aria-labelledby="month-title"></div>
    <aside class="day-details" id="day-details" aria-labelledby="day-title" hidden>
      <div class="detail-header">
        <h3 id="day-title"></h3>
        <button class="action-button" type="button" id="close-day" aria-label="Close day details">×</button>
      </div>
      <div id="day-weather"></div>
      <div id="day-events" tabindex="0" role="region" aria-label="Events for selected day"></div>
    </aside>
  </div>
</div>
</section>
<section class="side" id="widget-panel" aria-labelledby="widgets-title">
<h3 id="widgets-title">Quick Widgets</h3>
<div class="widget-grid"></div></section>
</div><p class="muted" id="status" role="status" hidden></p>
<dialog id="week-day-details" aria-labelledby="week-day-title">
  <div class="detail-header">
    <h2 id="week-day-title"></h2>
    <form method="dialog"><button class="action-button" aria-label="Close day details">×</button></form>
  </div>
  <div id="week-day-events"></div>
</dialog>
<dialog id="forecast-details" aria-labelledby="forecast-title">
  <div class="detail-header">
    <h2 id="forecast-title"></h2>
    <form method="dialog"><button class="action-button" aria-label="Close forecast">×</button></form>
  </div>
  <p id="forecast-summary"></p>
</dialog>
</main>`;

function mount(root, host) {
  const document = {getElementById: id => root.getElementById(id)};
  const configStatus = document.getElementById('config-status');
  configStatus.textContent = host.configWarnings.join(' ');
  configStatus.hidden = !host.configWarnings.length;
  const weekDays = document.getElementById('week-days');
  const monthGrid = document.getElementById('month-grid');
  const dayDetails = document.getElementById('day-details');
  const firstDay = host.config.week_start === 'sunday' ? 0 : 1;
  const weekdays = [...DAYS.slice(firstDay), ...DAYS.slice(0, firstDay)];
  let zone = host.hass?.config?.time_zone;
  let time = calendarTime(zone);
  let today = time.dayAt(Date.now());
  let weekStart = addDays(today, -weekOffset(today, firstDay));
  let weekDates = weekdays.map((_, index) => addDays(weekStart, index));
  let monthView = host.config.default_view === 'month';
  let month = monthDate(today);
  let selectedDay = null;
  let calendarEvents = [];
  let selectedCalendar = null;
  const forecasts = new Map();
  let subscription;
  const weatherStatus = document.getElementById('weather-status');
  const weatherEntity = () => host.hass?.states[host.config.weather_entity];
  const temperatureUnit = () => weatherEntity()?.attributes.temperature_unit
    ?? host.hass?.config?.unit_system?.temperature;
  let lastTemperature;
  let lastUnit;

  function redrawCalendar(refreshEvents = true) {
    const active = root.activeElement?.dataset;
    renderCalendar(refreshEvents);
    if (active?.forecast !== undefined) weekDays.querySelector(`[data-forecast="${active.forecast}"]`)?.focus();
    if (active?.weekDay !== undefined) weekDays.querySelector(`[data-week-day="${active.weekDay}"]`)?.focus();
    if (active?.day !== undefined) monthGrid.querySelector(`[data-day="${active.day}"]`)?.focus({preventScroll:true});
  }

  function stopWeather() {
    const previous = subscription;
    subscription = undefined;
    forecasts.clear();
    if (previous?.unsubscribe) Promise.resolve().then(previous.unsubscribe).catch(() => {});
  }

  function startWeather() {
    const id = host.config.weather_entity;
    const connection = host.hass?.connection;
    if (!host.isConnected || !id || !connection || (subscription?.connection === connection && subscription.zone === zone)) return;
    stopWeather();
    const current = {connection, zone};
    redrawCalendar(false);
    subscription = current;
    weatherStatus.textContent = 'Loading daily forecast…';
    weatherStatus.hidden = false;
    Promise.resolve().then(() => connection.subscribeMessage(message => {
      if (subscription !== current) return;
      forecasts.clear();
      for (const forecast of Array.isArray(message?.forecast) ? message.forecast : []) {
        if (!forecast || typeof forecast.datetime !== 'string') continue;
        const instant = Date.parse(forecast.datetime);
        if (!Number.isFinite(instant) || (!forecast.condition && !Number.isFinite(forecast.temperature)
          && !Number.isFinite(forecast.templow))) continue;
        const key = /^\d{4}-\d{2}-\d{2}$/.test(forecast.datetime)
          ? forecast.datetime : dateKey(time.dayAt(instant));
        forecasts.set(key, forecast);
      }
      weatherStatus.textContent = forecasts.size ? '' : 'Daily forecast unavailable.';
      weatherStatus.hidden = Boolean(forecasts.size);
      redrawCalendar(false);
    }, {type:'weather/subscribe_forecast', entity_id:id, forecast_type:'daily'}))
      .then(unsubscribe => {
        if (subscription === current) current.unsubscribe = unsubscribe;
        else return unsubscribe();
      })
      .catch(() => {
        if (subscription !== current) return;
        weatherStatus.textContent = 'Daily forecast unavailable for the selected weather entity.';
        weatherStatus.hidden = false;
        redrawCalendar(false);
      });
  }

  function forecastMarkup(date, index, forecast) {
    const high = forecast.temperature;
    const low = forecast.templow;
    const isToday = +date === +today;
    const current = weatherEntity()?.attributes.temperature;
    const position = isToday ? temperaturePosition(current, high, low) : null;
    const unit = temperatureUnit();
    const wide = high - low >= (unit === '°F' ? 18 : 10);
    const icon = weatherIcon(forecast);
    const temperatureLabel = unit ? ' '+escapeText(unit) : ' degrees';
    const heading = index === null ? icon : `<button class="weather-button" type="button" data-forecast="${index}" aria-haspopup="dialog"
        aria-label="Forecast for ${weekdays[index]} ${date.getUTCDate()}">${icon}</button>`;
    return `<div class="weather${index === null ? ' horizontal' : ''}" aria-label="Daily forecast">
      ${heading}
      ${Number.isFinite(high) ? `<span aria-label="High ${high}${temperatureLabel}">${high}${escapeText(unit ?? '°')}</span>` : ''}
      ${Number.isFinite(high) && Number.isFinite(low) ? `<span class="range ${wide ? 'wide-range' : ''}" aria-hidden="true">
        ${isToday ? `<span class="current" data-high="${high}" data-low="${low}" ${position === null ? 'hidden' : ''} style="--position:${position ?? 50}%"></span>` : ''}
      </span>` : ''}
      ${Number.isFinite(low) ? `<span aria-label="Low ${low}${temperatureLabel}">${low}${escapeText(unit ?? '°')}</span>` : ''}
    </div>`;
  }
  let request = 0;
  let expanded = host.config.ribbon_default !== 'collapsed';
  const status = document.getElementById('status');
  const report = message => { status.textContent = message; status.hidden = !message; };
  const calendarStatus = document.getElementById('calendar-status');
  const controls = document.getElementById('quick-controls');
  const toggle = document.getElementById('quick-toggle');

  function updateRibbon() {
    controls.hidden = !expanded;
    toggle.textContent = expanded ? '▾ Quick Actions' : '▸ Quick Actions';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  toggle.onclick = () => { expanded = !expanded; updateRibbon(); };
  updateRibbon();

  const legend = document.getElementById('calendar-legend');
  const colors = new Map(host.config.calendars.map((id, index) => [id, calendarColor(host.config, id, index)]));
  const legendItems = Array.from(colors, ([id, color]) => {
    const item = window.document.createElement('li');
    const button = window.document.createElement('button');
    button.type = 'button';
    button.style.setProperty('--event-color', color);
    button.textContent = id;
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      selectedCalendar = selectedCalendar === id ? null : id;
      for (const [calendar, control] of legendItems) {
        control.setAttribute('aria-pressed', String(calendar === selectedCalendar));
      }
      redrawCalendar();
    };
    item.append(button);
    legend.append(item);
    return [id, button];
  });
  legend.hidden = !legendItems.length;

  function eventsOn(date) {
    const start = time.midnight(date);
    const next = time.midnight(addDays(date, 1));
    return calendarEvents.filter(event => (!selectedCalendar || event.calendarId === selectedCalendar)
      && event.start < next && event.end > start)
      .map(event => [event.summary, colors.get(event.calendarId), {time:time.when(event.start, event.end, date, event.allDay),
        location:event.location, description:event.description}]);
  }

  async function loadCalendar() {
    const current = ++request;
    const {hass, config} = host;
    const nextZone = hass?.config?.time_zone;
    if (nextZone !== zone) {
      zone = nextZone;
      time = calendarTime(zone);
      calendarEvents = [];
    }
    const newToday = time.dayAt(Date.now());
    if (+today !== +newToday) {
      if (+month === +monthDate(today) && +month !== +monthDate(newToday)) {
        month = monthDate(newToday);
        selectedDay = null;
      }
      today = newToday;
      weekStart = addDays(today, -weekOffset(today, firstDay));
      weekDates = weekdays.map((_, index) => addDays(weekStart, index));
    }
    redrawCalendar();
    startWeather();
    if (!hass) return;
    if (!config.calendars.length) {
      calendarStatus.textContent = 'Choose calendars in the card editor.';
      return;
    }
    const weekEnd = addDays(weekStart, 7);
    const monthEnd = monthDate(month, 1);
    const start = new Date(Math.min(weekStart, month));
    const end = new Date(Math.max(weekEnd, monthEnd));
    // Fetch each visible range independently to avoid pulling events between distant months.
    const ranges = month < weekEnd && monthEnd > weekStart ? [[start,end]] : [[weekStart,weekEnd],[month,monthEnd]];
    calendarStatus.textContent = 'Loading events…';
    const results = await Promise.allSettled(config.calendars.flatMap(id => ranges.map(async ([from,to]) => {
      const query = new URLSearchParams({start:time.midnight(from).toISOString(), end:time.midnight(to).toISOString()});
      const events = await hass.callApi('GET', 'calendars/'+encodeURIComponent(id)+'?'+query);
      const endpoint = value => value.dateTime ? new Date(value.dateTime) : time.midnight(new Date(value.date));
      return events.filter(event => event.start && event.end).map(event => ({...event, calendarId:id,
        start:endpoint(event.start), end:endpoint(event.end), allDay:Boolean(event.start.date)}));
    })));
    if (current !== request) return;
    calendarEvents = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .sort((a,b) => a.start-b.start);
    calendarStatus.textContent = results.some(result => result.status === 'rejected') ? 'Some calendars could not load.' : '';
    redrawCalendar();
  }

  const actionButtons = host.config.actions.map(id => {
    const button = window.document.createElement('button');
    const label = window.document.createElement('span');
    const state = window.document.createElement('small');
    const domain = domainOf(id);
    button.type = 'button';
    button.className = 'quick-control';
    const icon = window.document.createElement('ha-icon');
    icon.setAttribute('aria-hidden', 'true');
    const appearance = host.config.action_appearance?.[id] ?? {};
    icon.icon = isIcon(appearance.icon) ? appearance.icon : ACTION_ICONS[domain];
    label.append(window.document.createTextNode(id), state);
    button.append(icon, label);
    controls.append(button);
    let pending = false;
    button.onclick = async () => {
      if (pending || button.disabled || !host.hass?.states[id]) return;
      if (domain === 'cover' && !window.confirm('Open '+label.firstChild.textContent+'?')) return;
      pending = true;
      button.disabled = true;
      report('');
      try { await host.hass.callService(domain, ACTIONS[domain], {entity_id:id}); }
      catch { report('Could not run '+label.firstChild.textContent+'.'); }
      finally { pending = false; updateEntities(); }
    };
    return {id, button, label, state, appearance, busy:() => pending};
  });
  if (!actionButtons.length) controls.textContent = 'Add entities in the card editor.';
  const widgetPanel = document.getElementById('widget-panel');
  const widgetGrid = widgetPanel.querySelector('.widget-grid');
  widgetGrid.classList.toggle('wide', host.config.widget_layout === 'wide');
  const widgets = [...host.widgetCache].map(([key, entry]) => {
    const slot = window.document.createElement('div');
    slot.className = 'widget-slot';
    const status = window.document.createElement('p');
    status.className = 'widget-status muted';
    status.setAttribute('role', 'status');
    slot.append(status);
    widgetGrid.append(slot);
    return {key, entry, slot, status};
  });
  widgetGrid.dataset.count = String(widgets.length);
  widgetPanel.hidden = !widgets.length;

  function updateWidgets(hass) {
    if (!host.isConnected) return;
    for (const {key, entry, slot, status} of widgets) {
      const showError = () => {
        entry.failed = true;
        status.textContent = `Could not load ${entry.config.name || entry.config.title || entry.config.entity || entry.config.type}. Check the widget YAML and Home Assistant frontend.`;
        slot.replaceChildren(status);
      };
      if (entry.failed) {
        if (slot.firstChild !== status || !status.textContent) showError();
      } else if (entry.card) {
        try {
          // Home Assistant sends a fresh hass object when entity state changes.
          if (entry.hass !== hass) {
            entry.card.hass = hass;
            entry.hass = hass;
          }
          if (slot.firstChild !== entry.card) slot.replaceChildren(entry.card);
        } catch {
          showError();
        }
      } else if (!entry.pending) {
        status.textContent = 'Loading widget…';
        entry.pending = loadCardHelpers()
          .then(helpers => helpers.createCardElement(JSON.parse(key)))
          .then(card => {
            if (!(card instanceof HTMLElement) || card.localName === 'hui-error-card') throw new Error('Invalid widget');
            entry.card = card;
          })
          .catch(() => { entry.failed = true; })
          .finally(() => {
            entry.pending = null;
            if (host.widgetCache.get(key) === entry) host.view?.updateWidgets(host.hass);
          });
      }
    }
  }

  function updateEntities() {
    const hass = host.hass;
    if (!hass) return;
    for (const [id, item] of legendItems) {
      item.textContent = hass.states[id]?.attributes.friendly_name || id;
    }
    const current = weatherEntity()?.attributes.temperature;
    const unit = temperatureUnit();
    if (lastUnit !== unit && forecasts.size) {
      redrawCalendar(false);
    } else if (lastTemperature !== current) {
      for (const marker of root.querySelectorAll('.current[data-high]')) {
        const position = temperaturePosition(current, Number(marker.dataset.high), Number(marker.dataset.low));
        marker.hidden = position === null;
        if (position !== null) marker.style.setProperty('--position', position+'%');
      }
    }
    lastTemperature = current;
    lastUnit = unit;
    for (const {id,button,label,state,appearance,busy} of actionButtons) {
      const entity = hass.states[id];
      label.firstChild.textContent = entity?.attributes.friendly_name || id;
      state.textContent = entity?.state ?? 'Unavailable';
      const domain = domainOf(id);
      button.disabled = busy() || !entity || ['unavailable','unknown'].includes(entity.state) ||
        (domain === 'cover' && entity.state !== 'closed');
      const on = entity?.state === 'on';
      if (ACTIONS[domain] === 'toggle') button.setAttribute('aria-pressed', String(on));
      const fill = on ? appearance.on_color : appearance.off_color;
      button.toggleAttribute('data-custom-fill', isHexColor(fill));
      if (isHexColor(fill)) button.style.setProperty('--action-fill', fill);
    }
    updateWidgets(hass);
  }
  function eventCards(events, tag = 'div') {
    return events.map(([title, color]) => `<${tag} class="event" style="--event-color:${color}">${escapeText(title)}</${tag}>`).join('');
  }

  function dayEventCards(events) {
    return events.map(([title, color, details = {}]) => `<article class="event day-event" style="--event-color:${color}">
      <strong>${escapeText(title)}</strong>
      ${details.time ? `<p class="event-meta"><span class="event-icon" role="img" aria-label="Time">🕒</span><span>${escapeText(details.time)}</span></p>` : ''}
      ${details.location ? `<p class="event-meta"><span class="event-icon" role="img" aria-label="Location">📍</span><span>${escapeText(details.location)}</span></p>` : ''}
      ${details.description ? `<details>
        <summary><span class="event-icon" aria-hidden="true">📝</span> Event notes
          <span class="description-preview">${escapeText(details.description)}</span>
        </summary>
        <p class="description-full">${escapeText(details.description)}</p>
      </details>` : ''}
    </article>`).join('');
  }


  function renderCalendar(refreshEvents = true) {
    document.getElementById('week').hidden = monthView;
    document.getElementById('month').hidden = !monthView;
    document.getElementById('week-view').setAttribute('aria-pressed', String(!monthView));
    document.getElementById('month-view').setAttribute('aria-pressed', String(monthView));
    if (!monthView) {
      weekDays.innerHTML = weekDates.map((date, index) => {
        const forecast = forecasts.get(dateKey(date));
        return `<article class="day">
        <button type="button" class="day-heading" data-week-day="${index}" aria-haspopup="dialog" aria-label="View events for ${weekdays[index]} ${date.getUTCDate()}">${weekdays[index]} ${date.getUTCDate()}</button>
        <div class="day-body ${forecast ? '' : 'events-only'}">
          ${forecast ? forecastMarkup(date, index, forecast) : ''}
          <div class="events">${eventCards(eventsOn(date))}</div>
        </div>
      </article>`;
      }).join('');
      return;
    }

    const offset = weekOffset(month, firstDay);
    const dayCount = monthDate(month, 1, 0).getUTCDate();
    document.getElementById('month-title').textContent = dateLabel(month, {month:'long', year:'numeric'});
    monthGrid.innerHTML = weekdays.map(day => `<div class="weekday">${day}</div>`).join('') +
      '<span aria-hidden="true"></span>'.repeat(offset) +
      Array.from({length:dayCount}, (_, index) => {
        const day = index+1;
        const date = monthDate(month, 0, day);
        const events = eventsOn(date);
        const forecast = forecasts.get(dateKey(date));
        return `<button type="button" class="month-day" data-day="${day}" aria-controls="day-details"
          aria-expanded="${day === selectedDay}"${+date === +today ? ' aria-current="date"' : ''}>
          <span class="month-day-top"><span class="month-date">${day}</span>${forecast ? weatherIcon(forecast) : ''}</span>
          ${eventCards(events.slice(0, 3), 'span')}
          ${events.length > 3 ? `<small>+${events.length - 3} more</small>` : ''}
        </button>`;
      }).join('');
    dayDetails.hidden = selectedDay === null;
    document.getElementById('month-content').classList.toggle('has-details', selectedDay !== null);
    const weather = document.getElementById('day-weather');
    if (selectedDay === null) {
      weather.replaceChildren();
      return;
    }
    const date = monthDate(month, 0, selectedDay);
    const forecast = forecasts.get(dateKey(date));
    weather.innerHTML = forecast ? forecastMarkup(date, null, forecast) : '';
    if (refreshEvents) {
      document.getElementById('day-title').textContent = dateLabel(date, {weekday:'short', month:'short', day:'numeric'});
      const eventList = document.getElementById('day-events');
      eventList.innerHTML = dayEventCards(eventsOn(date)) || '<p>No events</p>';
      eventList.scrollTop = 0;
    }
  }


  weekDays.addEventListener('click', event => {
    const weatherButton = event.target.closest('[data-forecast]');
    if (weatherButton) {
      const date = weekDates[Number(weatherButton.dataset.forecast)];
      const forecast = forecasts.get(dateKey(date));
      if (!forecast) return;
      const entity = weatherEntity();
      const unit = temperatureUnit() ?? '°';
      const temperature = value => Number.isFinite(value) ? `${value} ${unit}` : null;
      const high = temperature(forecast.temperature);
      const low = temperature(forecast.templow);
      const isToday = +date === +today;
      const current = isToday ? temperature(entity?.attributes.temperature) : null;
      document.getElementById('forecast-title').textContent = dateLabel(date, {weekday:'long', month:'short', day:'numeric'});
      document.getElementById('forecast-summary').textContent = [
        typeof forecast.condition === 'string' && forecast.condition.replace(/[-_]/g, ' '), high && `High ${high}`,
        low && `Low ${low}`, current && `Current ${current}`,
        Number.isFinite(forecast.precipitation_probability) && `Rain chance ${forecast.precipitation_probability}%`
      ].filter(Boolean).join(' · ') || 'Forecast unavailable';
      document.getElementById('forecast-details').showModal();
      return;
    }
    const dayButton = event.target.closest('[data-week-day]');
    if (dayButton) {
      const index = Number(dayButton.dataset.weekDay);
      const dialog = document.getElementById('week-day-details');
      document.getElementById('week-day-title').textContent = dateLabel(weekDates[index], {weekday:'long', month:'short', day:'numeric'});
      document.getElementById('week-day-events').innerHTML = dayEventCards(eventsOn(weekDates[index])) || '<p>No events</p>';
      dialog.showModal();
      dialog.scrollTop = 0;
      return;
    }
  });
  document.getElementById('week-view').addEventListener('click', () => {
    monthView = false;
    renderCalendar();
  });
  document.getElementById('month-view').addEventListener('click', () => {
    monthView = true;
    renderCalendar();
  });
  monthGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (!button) return;
    const day = Number(button.dataset.day);
    selectedDay = selectedDay === day ? null : day;
    renderCalendar();
    monthGrid.querySelector(`[data-day="${day}"]`).focus({preventScroll:true});
    if (selectedDay !== null &&
        dayDetails.getBoundingClientRect().top > monthGrid.getBoundingClientRect().top) {
      dayDetails.scrollIntoView({block:'nearest'});
    }
  });
  document.getElementById('close-day').addEventListener('click', () => {
    const day = selectedDay;
    selectedDay = null;
    renderCalendar();
    monthGrid.querySelector(`[data-day="${day}"]`).focus();
  });
  for (const [id, direction] of [['previous-month', -1], ['next-month', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
      month = monthDate(month, direction);
      selectedDay = null;
      calendarEvents = [];
      loadCalendar();
    });
  }
  return {loadCalendar, updateEntities, updateWidgets, startWeather, stop() { request++; stopWeather(); }};
}

class FamilyHubLiveEditor extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this.render();
  }

  set hass(hass) {
    const catalog = Object.keys(hass.states).join(',');
    this._hass = hass;
    if (catalog !== this.catalog) {
      this.catalog = catalog;
      this.render();
    }
  }

  render() {
    if (!this.config || !this._hass) return;
    this.replaceChildren();
    const warnings = [];
    const normalized = normalizeConfig(this.config, warnings);
    const save = (key, value) => this.dispatchEvent(new CustomEvent('config-changed', {
      detail:{config:{...this.config,[key]:value}}, bubbles:true, composed:true
    }));
    for (const [key, title, limit, allowed] of [
      ['calendars','Calendars',Infinity,id => domainOf(id) === 'calendar'],
      ['actions','Quick Actions',MAX_ITEMS,id => Object.hasOwn(ACTIONS, domainOf(id))],
      ['widgets','Quick Widgets',MAX_ITEMS,() => true]
    ]) {
      const selected = normalized[key];
      const selectedKeys = new Set(key === 'widgets' ? selected.map(widgetKey) : selected);
      const section = document.createElement('fieldset');
      const heading = document.createElement('legend');
      heading.textContent = title;
      section.append(heading);
      for (const [index, entry] of selected.entries()) {
        const id = typeof entry === 'string' ? entry : entry.entity;
        const row = document.createElement('p');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        const name = this._hass.states[id]?.attributes.friendly_name || id || entry.title || entry.type;
        remove.setAttribute('aria-label', 'Remove '+name);
        remove.onclick = () => save(key, selected.filter((_, itemIndex) => itemIndex !== index));
        row.append(name+' ',remove);
        if (key === 'calendars') {
          const picker = document.createElement('input');
          picker.type = 'color';
          picker.value = calendarColor(this.config, id, selected.indexOf(id));
          picker.setAttribute('aria-label', 'Calendar color for '+name);
          picker.onchange = () => save('calendar_colors', {...this.config.calendar_colors,[id]:picker.value});
          row.append(' ',picker);
        }
        section.append(row);
        if (key === 'actions') {
          const appearance = this.config.action_appearance?.[id] ?? {};
          const saveAppearance = (property, value) => save('action_appearance', {
            ...this.config.action_appearance, [id]:{...appearance,[property]:value}
          });
          const fields = document.createElement('div');
          const iconLabel = document.createElement('label');
          const iconInput = document.createElement('input');
          const suggestions = document.createElement('datalist');
          suggestions.id = 'fh-icons-'+id.replace('.', '-');
          for (const icon of ACTION_ICON_CHOICES) suggestions.append(new Option(icon, icon));
          iconInput.setAttribute('list', suggestions.id);
          iconInput.placeholder = ACTION_ICONS[domainOf(id)];
          iconInput.value = appearance.icon ?? '';
          iconInput.onchange = () => {
            const value = iconInput.value.trim();
            iconInput.setCustomValidity(value && !isIcon(value) ? 'Use an icon name such as mdi:lightbulb.' : '');
            if (iconInput.reportValidity()) saveAppearance('icon', value);
          };
          iconLabel.append('Icon ',iconInput);
          fields.append(iconLabel,suggestions);
          const colorFields = Object.hasOwn(ACTIONS, domainOf(id)) && ACTIONS[domainOf(id)] === 'toggle'
            ? [['off_color','Off fill'],['on_color','On fill']] : [['off_color','Button fill']];
          for (const [property,title] of colorFields) {
            const label = document.createElement('label');
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = isHexColor(appearance[property]) ? appearance[property] : '#4a90e2';
            picker.onchange = () => saveAppearance(property,picker.value);
            label.append(title+' ',picker);
            fields.append(label);
            if (isHexColor(appearance[property])) {
              const reset = document.createElement('button');
              reset.type = 'button';
              reset.textContent = 'Use theme';
              reset.setAttribute('aria-label', 'Use theme for '+title.toLowerCase()+' on '+name);
              reset.onclick = () => saveAppearance(property,'');
              fields.append(reset);
            }
          }
          section.append(fields);
        }
      }
      const picker = document.createElement('select');
      picker.setAttribute('aria-label', 'Choose '+title.toLowerCase()+' entity');
      picker.add(new Option('Select an entity',''));
      for (const id of Object.keys(this._hass.states).filter(allowed).sort()) {
        if (!selectedKeys.has(key === 'widgets' ? widgetKey(id) : id)) {
          const name = this._hass.states[id].attributes.friendly_name;
          picker.add(new Option(name ? name+' ('+id+')' : id,id));
        }
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = selected.length >= limit ? 'Limit reached' : '+ Add';
      add.disabled = true;
      picker.disabled = selected.length >= limit || picker.options.length === 1;
      picker.onchange = () => { add.disabled = !picker.value; };
      add.onclick = () => save(key, [...selected,picker.value]);
      section.append(picker,add);
      if (key === 'widgets') {
        const hint = document.createElement('p');
        hint.textContent = 'Use the code editor to add built-in card configurations or change their options.';
        section.append(hint);
      }
      this.append(section);
    }
    const weatherLabel = document.createElement('label');
    const weatherPicker = document.createElement('select');
    weatherPicker.add(new Option('None', ''));
    const weatherEntities = Object.keys(this._hass.states).filter(id => domainOf(id) === 'weather').sort();
    const selectedWeather = normalized.weather_entity;
    if (selectedWeather && !weatherEntities.includes(selectedWeather)) weatherEntities.push(selectedWeather);
    for (const id of weatherEntities) {
      weatherPicker.add(new Option(this._hass.states[id]?.attributes.friendly_name || id, id));
    }
    weatherPicker.value = selectedWeather ?? '';
    weatherPicker.onchange = () => save('weather_entity', weatherPicker.value);
    weatherLabel.append('Calendar weather ', weatherPicker);
    this.append(weatherLabel);

    const defaults = document.createElement('fieldset');
    const defaultsHeading = document.createElement('legend');
    defaultsHeading.textContent = 'Startup defaults';
    defaults.append(defaultsHeading);
    for (const [key, title, options] of [
      ['default_view','Calendar opens in',{week:'Week',month:'Month'}],
      ['week_start','First day of week',{monday:'Monday',sunday:'Sunday'}],
      ['ribbon_default','Quick Actions opens',{expanded:'Expanded',collapsed:'Collapsed'}]
    ]) {
      const row = document.createElement('p');
      const label = document.createElement('label');
      const picker = document.createElement('select');
      for (const [value,name] of Object.entries(options)) picker.add(new Option(name,value));
      picker.value = normalized[key];
      picker.onchange = () => save(key,picker.value);
      label.append(title+' ',picker);
      row.append(label);
      defaults.append(row);
    }
    this.append(defaults);

    const widgetLabel = document.createElement('label');
    const widgetPicker = document.createElement('select');
    widgetPicker.add(new Option('Side by side', 'grid'));
    widgetPicker.add(new Option('Full-width stack', 'wide'));
    widgetPicker.value = normalized.widget_layout;
    widgetPicker.onchange = () => save('widget_layout', widgetPicker.value);
    widgetLabel.append('Widget layout ',widgetPicker);
    this.append(widgetLabel);
    if (warnings.length) {
      const status = document.createElement('p');
      status.textContent = warnings.join(' ');
      this.append(status);
    }
  }
}

class FamilyHubLive extends HTMLElement {
  static getConfigElement() { return document.createElement(CARD+'-editor'); }
  static getStubConfig() { return {type:'custom:'+CARD, calendars:[], actions:[], widgets:[]}; }

  setConfig(config) {
    this.view?.stop();
    this.configWarnings = [];
    this.config = normalizeConfig(config, this.configWarnings);
    const previousWidgets = this.widgetCache;
    this.widgetCache = new Map(this.config.widgets.map(entry => {
      const key = widgetKey(entry);
      const previous = previousWidgets?.get(key);
      return [key, previous && !previous.failed ? previous : {config:widgetConfig(entry)}];
    }));
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    root.innerHTML = markup;
    this.view = mount(root,this);
    this.view.updateEntities();
    this.view.loadCalendar();
  }

  get hass() { return this._hass; }
  set hass(hass) {
    const first = !this._hass;
    const zoneChanged = this._hass?.config?.time_zone !== hass?.config?.time_zone;
    this._hass = hass;
    this.view?.updateEntities();
    if (first || zoneChanged) this.view?.loadCalendar();
    else this.view?.startWeather();
  }

  connectedCallback() {
    this.view?.updateEntities();
    this.view?.loadCalendar();
    this.refreshTimer = setInterval(() => this.view?.loadCalendar(), 5 * 60 * 1000);
  }
  disconnectedCallback() {
    clearInterval(this.refreshTimer);
    this.view?.stop();
  }
  getCardSize() { return 8; }
}

if (!customElements.get(CARD)) {
  customElements.define(CARD+'-editor',FamilyHubLiveEditor);
  customElements.define(CARD,FamilyHubLive);
  (window.customCards ??= []).push({type:CARD,name:'Family Hub Live',description:'Family calendar, quick actions and live widgets'});
}
