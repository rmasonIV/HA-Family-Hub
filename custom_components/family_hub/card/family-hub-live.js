const CARD = 'family-hub-live';
const BRIEFING_SENSOR = 'sensor.family_hub_daily_briefing';
const BRIEFING_SCRIPT = 'family_hub_generate_briefing';
const BRIEFING_ENABLED = 'input_boolean.family_hub_briefing_enabled';
const MAX_ITEMS = 4;
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const weekOffset = (date, firstDay) => (date.getUTCDay() - firstDay + DAYS.length) % DAYS.length;
function weatherCondition(condition) {
  if (typeof condition !== 'string' || !condition) return 'Daily forecast';
  const label = condition === 'partlycloudy' ? 'partly cloudy' : condition.replace(/[-_]/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function weatherIcon(forecast, decorative = false) {
  const condition = forecast.condition === 'clear_night' ? 'clear-night' : forecast.condition;
  const icon = WEATHER_ICONS.get(condition) ?? WEATHER_ICONS.get('unknown');
  const label = escapeText(weatherCondition(forecast.condition));
  return `<img class="forecast-icon" src="data:image/svg+xml;base64,${icon}" alt="${decorative ? '' : label}"${decorative ? '' : ` title="${label}"`}>`;
}
const temperaturePosition = (current, high, low) =>
  Number.isFinite(current) && Number.isFinite(high) && Number.isFinite(low) && high >= low
    ? (high === low ? 50 : Math.min(100, Math.max(0, 100 * (high-current)/(high-low))))
    : null;
const ACTION_ICONS = {
  light:'mdi:lightbulb', switch:'mdi:toggle-switch', input_boolean:'mdi:toggle-switch',
  script:'mdi:play-circle-outline', button:'mdi:gesture-tap-button',
  input_button:'mdi:gesture-tap-button', cover:'mdi:garage', climate:'mdi:thermostat'
};
const ACTION_ICON_CHOICES = [
  'mdi:lightbulb', 'mdi:lightbulb-on', 'mdi:lamps', 'mdi:floor-lamp', 'mdi:led-strip-variant',
  'mdi:toggle-switch', 'mdi:garage', 'mdi:door', 'mdi:fan', 'mdi:power',
  'mdi:play-circle-outline', 'mdi:gesture-tap-button', 'mdi:thermostat'
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
  script: 'turn_on', button: 'press', input_button: 'press', cover: 'open_cover',
  climate: 'set_temperature'
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

const isPathSegment = value => typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value);
function normalizeMealie(value, calendars, warnings) {
  if (value == null) return null;
  try {
    const {calendar, config_entry_id, url, group} = value;
    const base = new URL(url);
    if (!calendars.includes(calendar) || !isPathSegment(config_entry_id) || !isPathSegment(group)
        || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('Invalid Mealie settings');
    }
    base.pathname = base.pathname.replace(/\/+$/, '')+'/';
    return {calendar, config_entry_id, base, group};
  } catch {
    warnings.push('Mealie recipe details need a configured dinner calendar, a Home Assistant config entry ID, a Mealie URL, and a group slug.');
    return null;
  }
}

const APPEARANCE_OPTIONS = {
  frame:{off:'Off',retro_tv:'Retro TV'},
  seasonal_accent:{off:'Off',christmas_retro:'Retro Christmas'}
};

function normalizeAppearance(value, warnings) {
  if (value != null && !isRecord(value)) warnings.push('appearance must be a mapping.');
  const settings = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(APPEARANCE_OPTIONS).map(([key, options]) => {
    // Some YAML loaders parse an unquoted off as false.
    const choice = settings[key] === false ? 'off' : settings[key];
    if (typeof choice === 'string' && Object.hasOwn(options, choice)) return [key, choice];
    if (choice != null) warnings.push('appearance.'+key+' must be '+Object.keys(options).join(' or ')+'.');
    return [key, 'off'];
  }));
}

function normalizeConfig(input, warnings = []) {
  const {title: _legacyTitle, ...config} = isRecord(input) ? input : {};
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
  const calendars = list('calendars', id => isEntityId(id) && domainOf(id) === 'calendar' && id);
  return {
    ...config,
    calendars,
    daily_briefing:typeof config.daily_briefing === "boolean" ? config.daily_briefing : undefined,
    appearance:normalizeAppearance(config.appearance, warnings),
    mealie:normalizeMealie(config.mealie, calendars, warnings),
    actions:list('actions', id => isEntityId(id) && Object.hasOwn(ACTIONS,domainOf(id)) && id, MAX_ITEMS),
    widgets:list('widgets', widgetKey, MAX_ITEMS),
    weather_entity:weatherEntity,
    default_view:option('default_view', ['week','month','month_details']),
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
function getCardHelpers() {
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
function briefingTimestamp(instant, hass, timeZone) {
  const options = {dateStyle:'short', timeStyle:'short', timeZone};
  const timeFormat = hass?.locale?.time_format;
  if (timeFormat === '12' || timeFormat === '24') options.hourCycle = timeFormat === '12' ? 'h12' : 'h23';
  if (timeFormat === 'system') {
    options.hourCycle = new Intl.DateTimeFormat(undefined, {hour:'numeric'}).resolvedOptions().hourCycle;
  }
  for (const language of [hass?.locale?.language, hass?.language, hass?.config?.language]) {
    if (!language) continue;
    try {
      const locale = new Intl.Locale(language.replaceAll('_', '-'));
      const country = hass?.config?.country;
      const regional = !locale.region && /^[a-z]{2}$/i.test(country ?? '')
        ? new Intl.Locale(locale, {region:country}) : locale;
      const supported = Intl.DateTimeFormat.supportedLocalesOf([regional.toString(), locale.toString()]);
      if (supported.length) return new Intl.DateTimeFormat(supported, options).format(instant);
    } catch {
      // Try the next language if a saved locale is invalid.
    }
  }
  return new Intl.DateTimeFormat(undefined, options).format(instant);
}

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
  return {timeZone,dayAt,midnight,when(start,end,date,allDay) {
    if (allDay) return 'All day';
    const format = +dayAt(start) === +date && +dayAt(end) === +date ? time : datetime;
    return format.format(start)+' – '+format.format(end);
  }};
}

const daySummaryMarkup = `
  <section class="briefing" aria-label="AI briefing" hidden>
    <div class="detail-header">
      <strong>AI briefing</strong>
      <button type="button" class="action-button briefing-refresh"></button>
    </div>
    <p class="briefing-text" role="status"></p>
    <time class="briefing-time" hidden></time>
  </section>
  <section class="overlaps" aria-label="Potential overlaps" hidden>
    <strong>Potential overlaps</strong>
    <ul></ul>
  </section>`;

const tvAntenna = `<svg class="tv-antenna" viewBox="0 0 100 36" aria-hidden="true" focusable="false">
  <path d="M50 33L12 5m38 28L87 5" fill="none" stroke="#9b7950" stroke-width="2" stroke-linecap="round"/>
  <path d="M50 31L13 5m37 26L86 5" fill="none" stroke="#dfc697" stroke-width="1"/>
  <circle cx="12" cy="5" r="3" fill="#c1a06b"/>
  <circle cx="87" cy="5" r="3" fill="#c1a06b"/>
  <path d="M39 36a11 8 0 0 1 22 0Z" fill="#a38253"/>
</svg>`;

const christmasHolly = `<svg class="christmas-holly" viewBox="0 0 54 18" aria-hidden="true" focusable="false">
  <path d="M29 12C22 4 15 2 5 3c3 2 4 4 2 6 4-1 7 0 7 3 5-1 10 0 15 0Z" fill="#38604d"/>
  <path d="M24 12C32 5 39 2 50 4c-4 2-4 4-2 6-5-1-7 0-8 3-5-2-10-1-16-1Z" fill="#597857"/>
  <path d="M11 6l16 6L44 7" fill="none" stroke="#99a67a" stroke-width=".8"/>
  <g fill="#a64840"><circle cx="23" cy="11" r="3"/><circle cx="30" cy="10" r="3"/><circle cx="27" cy="15" r="2.8"/></g>
</svg>`;

const markup = ({frame, seasonal_accent:accent}) => {
  const decorated = frame !== 'off' || accent !== 'off';
  return `<style>
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
.quick-climate{grid-column:span 2;display:grid;gap:6px;min-width:0}
.quick-climate-heading{display:flex;align-items:center;gap:8px}
.quick-climate-heading ha-icon{flex:none}
.quick-climate-setpoint{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:4px;text-align:center}
.quick-climate [hidden]{display:none}
.quick-climate-setpoint button{min-height:44px;border:1px solid var(--fh-border);border-radius:6px;background:var(--fh-surface);color:inherit;font:inherit;font-size:1.25rem;touch-action:manipulation}
.quick-climate-setpoint button:disabled{opacity:.5}
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
.day.has-weather{--forecast-width:44px;display:grid;grid-template-columns:var(--forecast-width) minmax(0,1fr) var(--forecast-width);grid-template-rows:auto 1fr;align-items:start}
.day.has-weather .day-heading{grid-area:1 / 2}
.day.has-weather .weather{grid-area:1 / 1 / 3}
.day.has-weather .events{grid-area:2 / 2 / 3 / -1;margin-inline-start:6px}
.events{text-align:left}
.events .event{padding-inline:4px}
.weather{display:grid;justify-items:center;gap:3px;font-size:.75rem;font-variant-numeric:tabular-nums}
.forecast-icon{display:block;inline-size:32px;block-size:32px;object-fit:contain}
.weather-button{display:grid;place-items:center;border:0;background:transparent;padding:0;width:var(--forecast-width);height:44px;font-size:1.25rem}
.range{position:relative;width:6px;height:42px;border-radius:4px;background:linear-gradient(to top,#3b82f6,#ef4444)}
.day .range{height:90px}
.weather.horizontal{display:grid;justify-items:stretch;gap:8px;margin:10px 0 8px;padding:10px 12px;border-radius:8px;background:var(--fh-forecast-surface);font-size:.9rem}
.forecast-condition{display:flex;align-items:center;gap:8px;font-weight:600}
.forecast-condition .forecast-icon{inline-size:40px;block-size:40px;flex:none}
.forecast-temperatures{display:flex;align-items:center;gap:8px;font-weight:600}
.weather.horizontal .range{flex:1;min-width:12px;height:8px;background:linear-gradient(to right,#3b82f6,#ef4444)}
.weather.horizontal .wide-range{background:linear-gradient(to right,#3b82f6,#facc15,#ef4444)}
.weather.horizontal .current{top:50%;left:calc(100% - var(--position))}
#day-weather:empty{display:none}
.range.wide-range{background:linear-gradient(to top,#3b82f6,#facc15,#ef4444)}
.current[hidden]{display:none}
.quick-control ha-icon{flex:none;--mdc-icon-size:24px}
.current{position:absolute;top:var(--position);left:50%;width:9px;height:9px;transform:translate(-50%,-50%);border:1px solid #304459;border-radius:50%;background:white}
.calendar-header,.period-header,.detail-header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.period-header h3,.detail-header h3{margin:0}
.calendar-header{margin-bottom:8px}
.view-toggle{display:flex;gap:4px;margin-inline-start:auto}
.view-toggle [aria-pressed="true"],.month-day[aria-expanded="true"]{background:#dceafb}
.period-header{margin-bottom:10px}.period-navigation{display:flex;gap:6px;flex-wrap:wrap}
.month-content{display:grid;gap:12px}
.month-content.has-details{grid-template-columns:minmax(0,1fr) minmax(220px,32%)}
.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.weekday{text-align:center;font-size:.75rem}
.month-day{display:grid;align-content:start;gap:3px;min-width:0;min-height:66px;text-align:left;border:1px solid #dce2e9;border-radius:7px;background:white;padding:5px;color:inherit}
.month-content:not(.has-details) .month-day{min-height:clamp(64px,9dvh,112px)}
.day-details{display:flex;flex-direction:column;min-height:0;contain:size}
.day-details[hidden]{display:none}
#day-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain}
.briefing,.overlaps{padding:8px;margin-bottom:8px;border:1px solid var(--divider-color,#c8d0d9);border-radius:8px}
.briefing[hidden],.overlaps[hidden]{display:none}
.briefing-text{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.briefing-time{font-size:.8rem;color:var(--secondary-text-color,#526273)}
.overlaps ul{margin:4px 0;padding-inline-start:1.25em;overflow-wrap:anywhere}
.day-event{margin:6px 0;padding:10px}
.day-event p{margin:4px 0;overflow-wrap:anywhere}
.meal-recipe{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}
.meal-recipe-copy{flex:1 1 160px;min-width:0}
.day-event .meal-recipe-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:normal}
.meal-recipe img{inline-size:112px;block-size:84px;max-inline-size:100%;border-radius:6px;object-fit:cover}
.meal-recipe a{color:var(--link-text-color,var(--primary-text-color,inherit));font-weight:600;padding-block:8px}
.meal-recipe:empty{display:none}
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
.month-day-top .forecast-icon{inline-size:clamp(14px,4cqi,24px);block-size:clamp(14px,4cqi,24px);flex:none}
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

#assistant-dialog{width:min(36rem,calc(100% - 36px));box-sizing:border-box}
#assistant-dialog label{display:grid;gap:5px;margin-block:12px}
#assistant-dialog textarea,#assistant-dialog select{font:inherit;padding:8px;min-width:0}
#assistant-dialog [hidden]{display:none!important}
#assistant-preview{white-space:pre-wrap;overflow-wrap:anywhere;margin-block:12px}
.assistant-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
#calendar-status:empty{display:none} button:disabled{cursor:default;opacity:.55}

:host {
  display:block;
  color:var(--primary-text-color,#223047);
  background:transparent;
  --fh-surface:var(--ha-card-background,var(--card-background-color,#fff));
  --fh-forecast-surface:color-mix(in srgb,var(--secondary-background-color,var(--fh-border)) 65%,var(--fh-surface));
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
.calendar-legend {display:flex;flex-wrap:wrap;gap:2px 6px;padding:0;margin:0;min-inline-size:0;list-style:none;font-size:.85rem}
.calendar-legend[hidden] {display:none}
.calendar-legend button {display:flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:16px;padding:4px 8px;min-height:36px;background:transparent;color:inherit;text-align:start;overflow-wrap:anywhere}
.calendar-legend button[aria-pressed="true"]{border-color:var(--event-color);background:var(--fh-tint)}
.calendar-legend button::before {content:'';flex:none;width:10px;height:10px;border-radius:50%;background:var(--event-color)}
@container (max-width:720px) {.widget-grid[data-count="3"]{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:620px) {.action-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container (max-width:480px) {.widget-grid[data-count]{grid-template-columns:minmax(0,1fr)}}
.widget-grid.wide[data-count]{grid-template-columns:minmax(0,1fr)}
/* The bezel uses the card width. The existing calendar adapts to the space inside it. */
.calendar-surround {
  position:relative;
  min-inline-size:0;
  container-type:inline-size;
  --rim:clamp(4px,1.1cqi,16px);
}
.calendar-surround > svg {position:absolute;display:block;pointer-events:none}
.calendar-surround[data-frame="retro_tv"] {
  --antenna-height:clamp(18px,3.2cqi,36px);
  margin-block-start:var(--antenna-height);
  padding:var(--rim);
  border:1px solid #4c3025;
  border-radius:clamp(12px,2cqi,25px);
  background:
    repeating-linear-gradient(2deg,#341a101c 0 1px,transparent 2px 5px,#e8af741a 6px,transparent 8px 11px),
    linear-gradient(112deg,#67402e,#986344 35%,#784b34 67%,#563527);
  box-shadow:inset 0 1px #cc97676e,0 2px 4px #0003;
}
.calendar-surround[data-frame="retro_tv"] > .calendar {
  border:clamp(2px,.45cqi,6px) solid #eee0c1;
  box-shadow:0 0 0 1px #bb9964;
}
.tv-antenna {
  inset-block-end:100%;
  inset-inline:0;
  margin-inline:auto;
  block-size:var(--antenna-height);
}
.calendar-surround[data-seasonal-accent="christmas_retro"] {
  --accent-rail:clamp(12px,1.8cqi,22px);
  padding-block-start:var(--accent-rail);
}
.calendar-surround[data-frame="off"][data-seasonal-accent="christmas_retro"] {
  border:1px solid #54735f;
  border-radius:13px;
}
.christmas-holly {
  inset-block-start:1px;
  inset-inline-start:max(10px,var(--rim));
  block-size:calc(var(--accent-rail) - 2px);
}
.christmas-holly + .christmas-holly {
  inset-inline-start:auto;
  inset-inline-end:max(10px,var(--rim));
  transform:scaleX(-1);
}
@container (max-width:380px) {
  .calendar-surround .month-day-top .forecast-icon {inline-size:12px;block-size:12px}
}
</style><main><p id="config-status" class="muted" role="status" hidden></p><section class="quick-actions" aria-label="Quick Actions" id="quick-actions">
  <div class="quick-header">
    <button type="button" id="quick-toggle" aria-controls="quick-controls" aria-expanded="true">Quick Actions</button>
  </div>
  <div class="action-grid" id="quick-controls"></div></section>
<div class="layout" id="layout">
${decorated ? `<div class="calendar-surround" data-frame="${frame}" data-seasonal-accent="${accent}">
  ${frame === 'retro_tv' ? tvAntenna : ''}
  ${accent === 'christmas_retro' ? christmasHolly.repeat(2) : ''}` : ''}
<section class="calendar" aria-label="Family calendar">
<div class="calendar-header">
  <ul class="calendar-legend" id="calendar-legend" aria-label="Filter by calendar"></ul>
  <div class="view-toggle" role="group" aria-label="Calendar view">
    <button class="action-button" id="week-view" type="button" aria-pressed="true">Week</button>
    <button class="action-button" id="month-view" type="button" aria-pressed="false">Month</button>
  </div>
</div>
<button class="action-button" id="assistant-open" type="button" hidden>Add event with Assistant</button>
<dialog id="assistant-dialog" aria-labelledby="assistant-title">
  <h3 id="assistant-title">Add a calendar event</h3>
  <label id="assistant-request-label">Describe the event
    <textarea id="assistant-request" rows="3" maxlength="1000" placeholder="Soccer practice Thursday at 6 PM for 90 minutes"></textarea>
  </label>
  <label id="assistant-calendar-label">Calendar<select id="assistant-calendar"></select></label>
  <div id="assistant-preview" hidden></div>
  <p id="assistant-status" role="status" aria-live="polite"></p>
  <div class="assistant-actions">
    <button class="action-button" id="assistant-close" type="button">Cancel</button>
    <button class="action-button" id="assistant-edit" type="button" hidden>Edit request</button>
    <button class="action-button" id="assistant-propose" type="button">Review event</button>
    <button class="action-button" id="assistant-confirm" type="button" hidden>Create event</button>
  </div>
</dialog>
<p id="assistant-notice" role="status" hidden></p>
<p class="muted" id="calendar-status" role="status"></p><p id="weather-status" class="muted" role="status" hidden></p>
<div id="week">
  <div class="period-header">
    <h3 id="week-title" aria-live="polite"></h3>
    <div class="period-navigation" aria-label="Week navigation" role="group">
      <button class="action-button" id="previous-week" type="button" aria-label="Previous week">‹</button>
      <button class="action-button" id="current-week" type="button">This week</button>
      <button class="action-button" id="next-week" type="button" aria-label="Next week">›</button>
    </div>
  </div>
  <div class="days" id="week-days" aria-labelledby="week-title"></div>
</div>
<div id="month" hidden>
  <div class="period-header">
    <h3 id="month-title"></h3>
    <div class="period-navigation">
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
      <div id="day-scroll" tabindex="0" role="region" aria-label="Schedule for selected day">
        ${daySummaryMarkup}<div id="day-events"></div>
      </div>
    </aside>
  </div>
</div>
</section>
${decorated ? '</div>' : ''}
<section class="side" id="widget-panel" aria-labelledby="widgets-title">
<h3 id="widgets-title">Quick Widgets</h3>
<div class="widget-grid"></div></section>
</div><p class="muted" id="status" role="status" hidden></p>
<dialog id="week-day-details" aria-labelledby="week-day-title">
  <div class="detail-header">
    <h2 id="week-day-title"></h2>
    <form method="dialog"><button class="action-button" aria-label="Close day details">×</button></form>
  </div>
  <div id="week-day-weather"></div>
  ${daySummaryMarkup}<div id="week-day-events"></div>
</dialog>
<dialog id="forecast-details" aria-labelledby="forecast-title">
  <div class="detail-header">
    <h2 id="forecast-title"></h2>
    <form method="dialog"><button class="action-button" aria-label="Close forecast">×</button></form>
  </div>
  <p id="forecast-summary"></p>
</dialog>
</main>`;
};

function mountAssistant(root, host, reloadCalendar) {
  const el = id => root.getElementById('assistant-' + id);
  const dialog = el('dialog');
  const request = el('request');
  const calendar = el('calendar');
  const status = el('status');
  const preview = el('preview');
  const propose = el('propose');
  const confirm = el('confirm');
  const edit = el('edit');
  let availability;
  let proposal;
  let session = 0;
  let statusRequest = 0;
  let saving = false;

  const call = (action, data = {}) => host.hass.callWS({type:'family_hub/assistant/' + action, ...data});
  const messages = {
    unavailable:'Assistant or this calendar is unavailable for your account.',
    provider_error:'The AI Task could not prepare an event. Check the provider settings and try again.',
    invalid_output:'The AI Task returned an invalid event. Try a shorter request with a specific date and time.',
    clarify:'Enter a clear title, date and start time, or specify that the event is all day.',
    unsupported:'Assistant can create one non-repeating event at a time.',
    choose_calendar:'Choose an available calendar below and remove any conflicting calendar name from the request.',
    expired:'This preview expired. Review the request again.',
    busy:'Assistant is busy or a recent save is unverified. Check your calendar before trying again.',
    saving:'Home Assistant is still saving this event. Check the calendar before trying again.',
    uncertain:'The save could not be verified. Check your calendar before trying again.',
  };

  async function refresh() {
    if (!host.hass?.callWS) return;
    const current = ++statusRequest;
    try {
      const result = await call('status');
      if (current !== statusRequest) return;
      availability = result;
      el('open').hidden = !result?.visible;
    } catch {
      if (current !== statusRequest) return;
      availability = undefined;
      el('open').hidden = true;
    }
  }

  function setPreview(active) {
    preview.hidden = confirm.hidden = edit.hidden = !active;
    el('request-label').hidden = el('calendar-label').hidden = propose.hidden = active;
    if (!active) preview.textContent = '';
  }

  function discard() {
    if (!proposal) return;
    call('cancel', {proposal_id:proposal.id}).catch(() => {});
    proposal = undefined;
  }

  el('open').addEventListener('click', () => {
    session++;
    el('notice').hidden = true;
    request.value = '';
    setPreview(false);
    const calendars = Object.entries(availability?.calendars ?? {});
    calendar.replaceChildren();
    for (const [id, label] of [['', 'Use default'], ...calendars]) {
      const option = window.document.createElement('option');
      option.value = id;
      option.textContent = label;
      calendar.append(option);
    }
    const ready = calendars.length > 0 && availability?.configured;
    propose.disabled = !ready;
    confirm.disabled = false;
    el('request-label').hidden = el('calendar-label').hidden = propose.hidden = !ready;
    status.textContent = ready ? '' : 'Set up Family Assistant in Home Assistant → Settings → Devices & services → Family Hub Light → Configure.';
    dialog.showModal();
    if (ready) request.focus();
  });

  propose.addEventListener('click', async () => {
    if (!request.value.trim()) {
      status.textContent = 'Describe the event first.';
      request.focus();
      return;
    }
    const current = session;
    propose.disabled = request.disabled = calendar.disabled = true;
    status.textContent = 'Preparing event…';
    try {
      const result = await call('propose', {text:request.value, calendar:calendar.value});
      if (current !== session || !dialog.open) {
        if (result.status === 'proposal') call('cancel', {proposal_id:result.id}).catch(() => {});
        return;
      }
      if (result.status !== 'proposal') {
        status.textContent = messages[result.status] ?? messages.invalid_output;
        return;
      }
      proposal = result;
      const {event} = result;
      const format = value => new Intl.DateTimeFormat(undefined, {
        dateStyle:'medium', timeStyle:'short', timeZone:result.timezone,
      }).format(new Date(value));
      let interval;
      let duration;
      if (event.start_date) {
        const lastDay = new Date(Date.parse(event.end_date) - 86400000).toISOString().slice(0, 10);
        interval = lastDay === event.start_date
          ? `${event.start_date} · All day`
          : `${event.start_date} through ${lastDay} · All day`;
      } else {
        interval = `${format(event.start_date_time)} to ${format(event.end_date_time)} (${result.timezone})`;
        const minutes = (Date.parse(event.end_date_time) - Date.parse(event.start_date_time)) / 60000;
        duration = result.default_minutes ? `Default duration: ${minutes} minutes` : `Duration: ${minutes} minutes`;
      }
      preview.textContent = [
        event.summary, result.calendar, interval,
        duration, event.location, event.description,
      ].filter(Boolean).join('\n');
      setPreview(true);
      status.textContent = 'Review the event before creating it.';
      confirm.focus();
    } catch {
      if (current === session && dialog.open) status.textContent = messages.unavailable;
    } finally {
      if (current === session) propose.disabled = request.disabled = calendar.disabled = false;
    }
  });

  edit.addEventListener('click', () => {
    discard();
    setPreview(false);
    status.textContent = '';
    request.focus();
  });

  confirm.addEventListener('click', async () => {
    if (!proposal || saving) return;
    const current = session;
    saving = confirm.disabled = edit.disabled = el('close').disabled = true;
    status.textContent = 'Creating event…';
    try {
      const result = await call('confirm', {proposal_id:proposal.id});
      if (current !== session) return;
      if (result.status === 'created') {
        proposal = undefined;
        dialog.close();
        el('notice').textContent = 'Event created.';
        el('notice').hidden = false;
        reloadCalendar(result);
        return;
      }
      status.textContent = messages[result.status] ?? messages.uncertain;
    } catch {
      status.textContent = messages.uncertain;
    } finally {
      saving = edit.disabled = el('close').disabled = false;
      confirm.disabled = true;
    }
  });

  el('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    session++;
    discard();
    request.value = '';
    request.disabled = calendar.disabled = confirm.disabled = false;
    el('open').focus();
  });
  return {refresh, stop() {
    session++;
    statusRequest++;
    if (dialog.open && !saving) dialog.close();
  }};
}

const CLIMATE_SETPOINTS = {temperature:'Target', target_temp_low:'Low target', target_temp_high:'High target'};

function climateAdjustment(entity, key, direction) {
  const {state:mode, attributes} = entity ?? {};
  if (!Array.isArray(attributes?.hvac_modes) || !attributes.hvac_modes.includes(mode)) return;
  const range = mode === 'heat_cool';
  if (range ? key === 'temperature' : key !== 'temperature' || !['heat','cool'].includes(mode)) return;
  const feature = range ? 2 : 1; // Home Assistant ClimateEntityFeature target range / single target.
  if (!(attributes.supported_features & feature)) return;
  const {min_temp:min, max_temp:max, target_temp_step:reportedStep} = attributes;
  const target = attributes[key];
  if (![min, max, target].every(Number.isFinite)) return;
  const step = Number.isFinite(reportedStep) && reportedStep > 0 ? reportedStep : 1;
  const next = Number((target + direction * step).toFixed(8));
  if (next === target || next < min || next > max) return;
  if (!range) return {temperature:next};
  const low = key === 'target_temp_low' ? next : attributes.target_temp_low;
  const high = key === 'target_temp_high' ? next : attributes.target_temp_high;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < min || high > max || low >= high) return;
  return {target_temp_low:low, target_temp_high:high};
}

function mountClimateAction(controls, host, id) {
  const document = window.document;
  const appearance = host.config.action_appearance?.[id] ?? {};
  const tile = document.createElement('div');
  tile.className = 'quick-control quick-climate';
  tile.setAttribute('role', 'group');
  if (isHexColor(appearance.off_color)) {
    tile.setAttribute('data-custom-fill', '');
    tile.style.setProperty('--action-fill', appearance.off_color);
  }
  const heading = document.createElement('div');
  heading.className = 'quick-climate-heading';
  const icon = document.createElement('ha-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.icon = isIcon(appearance.icon) ? appearance.icon : ACTION_ICONS.climate;
  const label = document.createElement('strong');
  heading.append(icon, label);
  const indoor = document.createElement('small');
  const status = document.createElement('small');
  status.setAttribute('role', 'status');
  status.hidden = true;
  tile.append(heading, indoor);
  let pending = false;
  const rows = Object.entries(CLIMATE_SETPOINTS).map(([key, title]) => {
    const row = document.createElement('div');
    row.className = 'quick-climate-setpoint';
    const value = document.createElement('span');
    const buttons = [-1, 1].map((direction, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = index ? '+' : '−';
      const verb = index ? 'Increase' : 'Decrease';
      button.onclick = async () => {
        const hass = host.hass;
        const targets = climateAdjustment(hass?.states[id], key, direction);
        if (pending || !targets) return;
        pending = true;
        status.hidden = true;
        status.textContent = '';
        update(hass);
        try {
          await hass.callService('climate', ACTIONS.climate, {entity_id:id, ...targets});
        } catch {
          status.hidden = false;
          status.textContent = 'Could not set the temperature.';
        } finally {
          pending = false;
          update(host.hass);
        }
      };
      return {button, verb, direction};
    });
    row.append(buttons[0].button, value, buttons[1].button);
    tile.append(row);
    return {key, title, row, value, buttons};
  });
  tile.append(status);
  controls.append(tile);

  function update(hass) {
    const entity = hass.states[id];
    const attributes = entity?.attributes ?? {};
    const available = entity && !['unknown','unavailable'].includes(entity.state);
    const name = appearance.name || attributes.friendly_name || id;
    label.textContent = name;
    tile.setAttribute('aria-label', name);
    const unit = attributes.temperature_unit ?? hass.config?.unit_system?.temperature ?? '';
    const format = value => available && Number.isFinite(value) ? value + unit : '—';
    indoor.textContent = available ? 'Indoor: ' + format(attributes.current_temperature) : 'Unavailable';
    for (const {key, title, row, value, buttons} of rows) {
      row.hidden = (key !== 'temperature') !== (entity?.state === 'heat_cool');
      value.textContent = title + ': ' + format(attributes[key]);
      for (const {button, verb, direction} of buttons) {
        button.setAttribute('aria-label', verb + ' ' + name + ' ' + title.toLowerCase());
        button.disabled = row.hidden || pending || !climateAdjustment(entity, key, direction);
      }
    }
  }
  return update;
}

function mount(root, host) {
  const document = {getElementById: id => root.getElementById(id)};
  const configStatus = document.getElementById('config-status');
  configStatus.textContent = host.configWarnings.join(' ');
  configStatus.hidden = !host.configWarnings.length;
  const weekDays = document.getElementById('week-days');
  const monthGrid = document.getElementById('month-grid');
  const dayDetails = document.getElementById('day-details');
  const weekDetails = document.getElementById('week-day-details');
  let weekDetailDate = null;
  let briefingResponse;
  let briefingPending;
  let briefingError;
  let briefingSubscription;
  let briefingState;
  const firstDay = host.config.week_start === 'sunday' ? 0 : 1;
  const weekdays = [...DAYS.slice(firstDay), ...DAYS.slice(0, firstDay)];
  let zone = host.hass?.config?.time_zone;
  let time = calendarTime(zone);
  let today = time.dayAt(Date.now());
  const currentWeek = () => addDays(today, -weekOffset(today, firstDay));
  const weekLabel = new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
  let browsedWeek = null;
  let weekStart = currentWeek();
  let weekDates = weekdays.map((_, index) => addDays(weekStart, index));
  let monthView = host.config.default_view !== 'week';
  let month = monthDate(today);
  let selectedDay = host.config.default_view === 'month_details' ? today.getUTCDate() : null;
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
    const temperatureLabel = unit ? ' '+escapeText(unit) : ' degrees';
    const temperature = (name, value) => Number.isFinite(value)
      ? `<span aria-label="${name} ${value}${temperatureLabel}">${value}${escapeText(unit ?? '°')}</span>` : '';
    const range = Number.isFinite(high) && Number.isFinite(low)
      ? `<span class="range ${wide ? 'wide-range' : ''}" aria-hidden="true">
        ${isToday ? `<span class="current" data-high="${high}" data-low="${low}" ${position === null ? 'hidden' : ''} style="--position:${position ?? 50}%"></span>` : ''}
      </span>` : '';
    const highLabel = temperature('High', high);
    const lowLabel = temperature('Low', low);
    if (index === null) {
      return `<div class="weather horizontal" aria-label="Daily forecast">
        <div class="forecast-condition">${weatherIcon(forecast, true)}<span>${escapeText(weatherCondition(forecast.condition))}</span></div>
        ${highLabel || lowLabel ? `<div class="forecast-temperatures">${lowLabel}${range}${highLabel}</div>` : ''}
      </div>`;
    }
    return `<div class="weather" aria-label="Daily forecast">
      <button class="weather-button" type="button" data-forecast="${index}" aria-haspopup="dialog"
        aria-label="Forecast for ${weekdays[index]} ${date.getUTCDate()}">${weatherIcon(forecast)}</button>
      ${highLabel}${range}${lowLabel}
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

  function dayEvents(date) {
    const start = time.midnight(date);
    const next = time.midnight(addDays(date, 1));
    const pending = [...confirmedEvents.values()].map(({event}) => event);
    return [...calendarEvents, ...pending].filter(event => (!selectedCalendar || event.calendarId === selectedCalendar)
      && event.start < next && event.end > start).sort((a,b) => a.start-b.start);
  }

  function eventsOn(date) {
    return dayEvents(date).map(event => [event.summary, colors.get(event.calendarId), {time:time.when(event.start, event.end, date, event.allDay),
        location:event.location, description:event.description, calendarId:event.calendarId}]);
  }

  const confirmedEvents = new Map();
  const eventKey = event => JSON.stringify([
    event.calendarId, event.allDay, +event.start, +event.end,
    event.summary, event.description ?? '', event.location ?? '',
  ]);
  let retryTimer;
  const endpoint = value => value.dateTime ? new Date(value.dateTime) : time.midnight(new Date(value.date));

  function scheduleCalendarRefresh() {
    window.clearTimeout(retryTimer);
    if (!confirmedEvents.size) return;
    const next = Math.min(...[...confirmedEvents.values()].map(entry => entry.next));
    retryTimer = window.setTimeout(() => {
      for (const [key, entry] of confirmedEvents) {
        if (entry.next > Date.now()) continue;
        const delay = entry.delays.shift();
        if (delay) entry.next = Date.now() + delay;
        else confirmedEvents.delete(key);
      }
      loadCalendar();
      scheduleCalendarRefresh();
    }, Math.max(0, next - Date.now()));
  }

  const assistant = mountAssistant(root, host, ({calendar_id: calendarId, event: fields}) => {
    if (fields && colors.has(calendarId)) {
      const allDay = Boolean(fields.start_date);
      const event = {
        calendarId, allDay, summary:fields.summary, description:fields.description, location:fields.location,
        start:endpoint({date:fields.start_date, dateTime:fields.start_date_time}),
        end:endpoint({date:fields.end_date, dateTime:fields.end_date_time}),
      };
      const key = eventKey(event);
      // The provider can return a matching event before the confirmation response arrives.
      if (!calendarEvents.some(item => eventKey(item) === key)) {
        confirmedEvents.set(key, {event, next:Date.now() + 2000, delays:[3000, 10000, 15000, 30000]});
        scheduleCalendarRefresh();
      }
    }
    loadCalendar();
  });
  async function loadCalendar() {
    const current = ++request;
    const {hass, config} = host;
    const nextZone = hass?.config?.time_zone;
    if (nextZone !== zone) {
      zone = nextZone;
      time = calendarTime(zone);
      calendarEvents = [];
      confirmedEvents.clear();
      scheduleCalendarRefresh();
    }
    const newToday = time.dayAt(Date.now());
    if (+today !== +newToday) {
      if (+month === +monthDate(today)) {
        if (selectedDay === today.getUTCDate()) {
          month = monthDate(newToday);
          selectedDay = newToday.getUTCDate();
        } else if (selectedDay === null) {
          month = monthDate(newToday);
        }
      }
      today = newToday;
    }
    const nextWeekStart = browsedWeek ?? currentWeek();
    if (+weekStart !== +nextWeekStart) {
      weekStart = nextWeekStart;
      weekDates = weekdays.map((_, index) => addDays(weekStart, index));
    }
    redrawCalendar();
    startWeather();
    if (!hass) return;
    assistant.refresh();
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
      return events.filter(event => event.start && event.end).map(event => {
        const allDay = Boolean(event.start.date);
        // HA's Mealie calendar can give an all-day dinner the same start and end date.
        const end = id === config.mealie?.calendar && allDay && event.start.date === event.end.date
          ? time.midnight(addDays(new Date(event.start.date), 1))
          : endpoint(event.end);
        return {...event, calendarId:id, start:endpoint(event.start), end, allDay};
      });
    })));
    if (current !== request) return;
    calendarEvents = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .sort((a,b) => a.start-b.start);
    for (const event of calendarEvents) confirmedEvents.delete(eventKey(event));
    scheduleCalendarRefresh();
    calendarStatus.textContent = results.some(result => result.status === 'rejected') ? 'Some calendars could not load.' : '';
    redrawCalendar();
  }

  const climateUpdates = [];
  const actionButtons = host.config.actions.flatMap(id => {
    if (domainOf(id) === 'climate') {
      climateUpdates.push(mountClimateAction(controls, host, id));
      return [];
    }
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
  if (!host.config.actions.length) controls.textContent = 'Add entities in the card editor.';
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
        status.dataset.failed = '';
        status.textContent = `Could not load ${entry.config.name || entry.config.title || entry.config.entity || entry.config.type}. Check the widget YAML and Home Assistant frontend.`;
        slot.replaceChildren(status);
      };
      if (entry.failed) {
        if (!status.hasAttribute('data-failed')) showError();
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
        entry.pending = getCardHelpers()
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
    startBriefingSubscription();
    updateBriefings();
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
    for (const update of climateUpdates) update(hass);
    updateWidgets(hass);
  }
  function eventCards(events, tag = 'div') {
    return events.map(([title, color]) => `<${tag} class="event" style="--event-color:${color}">${escapeText(title)}</${tag}>`).join('');
  }

  const recipeCache = new Map();

  async function loadDinnerRecipes(day) {
    const {mealie} = host.config;
    const message = await host.hass.callWS({
      type:'call_service', domain:'mealie', service:'get_mealplan', return_response:true,
      service_data:{config_entry_id:mealie.config_entry_id, start_date:day, end_date:day}
    });
    const meals = message?.response?.mealplan;
    if (!Array.isArray(meals)) throw new Error('Invalid meal plan response');
    const recipes = new Map();
    for (const meal of meals) {
      const recipe = meal?.recipe;
      if (meal?.mealplan_date !== day || meal?.entry_type !== 'dinner' || !recipe
          || typeof recipe.name !== 'string' || !isPathSegment(recipe.slug)) continue;
      // Calendar events carry the title but no recipe ID. Skip ambiguous same-name recipes.
      if (!recipes.has(recipe.name)) recipes.set(recipe.name, recipe);
      else if (recipes.get(recipe.name)?.slug !== recipe.slug) recipes.set(recipe.name, null);
    }
    return recipes;
  }

  async function enrichDinnerEvents(events, date) {
    const containers = events.querySelectorAll('.meal-recipe');
    if (!containers.length || !host.hass) return;
    const day = dateKey(date);
    let cached = recipeCache.get(day);
    if (!cached || Date.now() >= cached.expires) {
      if (recipeCache.size >= 14) recipeCache.delete(recipeCache.keys().next().value);
      cached = {expires:Date.now()+5*60*1000, recipes:loadDinnerRecipes(day).catch(() => null)};
      recipeCache.set(day, cached);
    }
    const recipes = await cached.recipes;
    const {base,group} = host.config.mealie ?? {};
    for (const container of containers) {
      if (!container.isConnected || !base) continue;
      if (!recipes) {
        container.textContent = 'Recipe details unavailable.';
        continue;
      }
      const title = container.parentElement.querySelector('strong').textContent;
      const recipe = recipes.get(title);
      if (!recipe) continue;
      const link = window.document.createElement('a');
      link.href = new URL(`g/${group}/r/${recipe.slug}`, base).href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open in Mealie ↗';
      link.setAttribute('aria-label', `Open ${title} in Mealie (new tab)`);
      if (typeof recipe.image === 'string' && recipe.image.trim() && isPathSegment(recipe.recipe_id)) {
        const photo = window.document.createElement('img');
        photo.alt = '';
        photo.referrerPolicy = 'no-referrer';
        const imageDirectory = new URL(`api/media/recipes/${recipe.recipe_id}/images/`, base);
        const imageUrl = filename => {
          const url = new URL(filename, imageDirectory);
          url.searchParams.set('version', recipe.image);
          return url.href;
        };
        photo.addEventListener('error', () => {
          photo.addEventListener('error', () => photo.remove(), {once:true});
          photo.src = imageUrl('original.webp');
        }, {once:true});
        photo.src = imageUrl('min-original.webp');
        container.append(photo);
      }
      const copy = window.document.createElement('div');
      copy.className = 'meal-recipe-copy';
      if (typeof recipe.description === 'string' && recipe.description.trim()) {
        const description = window.document.createElement('p');
        description.className = 'meal-recipe-description';
        description.textContent = recipe.description.trim();
        copy.append(description);

        // HA may also include this text in the event notes. Keep the full notes expandable.
        const notes = container.parentElement.querySelector('details');
        if (notes?.querySelector('.description-full').textContent.trim() === description.textContent) {
          notes.querySelector('.description-preview').remove();
        }
      }
      copy.append(link);
      container.append(copy);
    }
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
      ${details.calendarId === host.config.mealie?.calendar && host.config.mealie ? '<div class="meal-recipe"></div>' : ''}
    </article>`).join('');
  }


  function renderDetailWeather(container, date) {
    const forecast = date && forecasts.get(dateKey(date));
    container.innerHTML = forecast ? forecastMarkup(date, null, forecast) : '';
  }

  function renderDaySchedule(panel, date, title, eventList) {
    title.textContent = dateLabel(date, {weekday:'long', month:'short', day:'numeric'});
    eventList.innerHTML = dayEventCards(eventsOn(date)) || '<p>No events</p>';
    enrichDinnerEvents(eventList, date);

    const start = +time.midnight(date);
    const end = +time.midnight(addDays(date, 1));
    const timed = new Map();
    for (const event of dayEvents(date)) {
      if (!event.allDay && event.start < event.end) {
        timed.set(JSON.stringify([+event.start, +event.end, event.summary]), event);
      }
    }
    const events = [...timed.values()];
    const overlaps = panel.querySelector('.overlaps');
    const list = overlaps.querySelector('ul');
    list.replaceChildren();
    for (let index = 0; index < events.length && list.children.length < 20; index++) {
      const event = events[index];
      for (let next = index + 1; next < events.length && list.children.length < 20; next++) {
        const other = events[next];
        if (Math.max(+event.start, +other.start, start) >= Math.min(+event.end, +other.end, end)) continue;
        const item = window.document.createElement('li');
        item.textContent = `${event.summary} overlaps ${other.summary}`;
        list.append(item);
      }
    }
    overlaps.hidden = !list.children.length;
    renderBriefing(panel, date);
  }

  function stopBriefingSubscription() {
    const previous = briefingSubscription;
    briefingSubscription = undefined;
    if (previous?.unsubscribe) Promise.resolve().then(previous.unsubscribe).catch(() => {});
  }

  function startBriefingSubscription() {
    const connection = host.hass?.connection;
    if (host.config.daily_briefing === false || !connection?.subscribeMessage ||
        briefingSubscription?.connection === connection) return;
    stopBriefingSubscription();
    const current = {connection};
    briefingSubscription = current;
    briefingState = undefined;
    briefingResponse = undefined;
    briefingError = undefined;
    Promise.resolve().then(() => connection.subscribeMessage(state => {
      if (briefingSubscription !== current) return;
      if (state.mode !== briefingState?.mode || state.revision !== briefingState?.revision) {
        briefingResponse = undefined;
        briefingError = undefined;
      }
      briefingState = state;
      updateBriefings();
    }, {type:'family_hub/briefing/subscribe'})).then(unsubscribe => {
      if (briefingSubscription === current) current.unsubscribe = unsubscribe;
      else return unsubscribe();
    }).catch(() => {
      // Older Family Hub servers support the YAML package path only.
      if (briefingSubscription === current && !briefingState) updateBriefings();
    });
  }

  function renderBriefing(panel, date) {
    const section = panel.querySelector('.briefing');
    const {hass, config} = host;
    const now = time.dayAt(Date.now());
    const managed = briefingState && briefingState.mode !== 'legacy';
    const enabled = config.daily_briefing !== false &&
      (config.daily_briefing === true || briefingState?.mode === 'ready');
    section.hidden = !enabled || !date || +date < +now;
    if (section.hidden) return;
    const day = dateKey(date);
    const isToday = +date === +now;
    const sensor = hass?.states[BRIEFING_SENSOR];
    const script = hass?.states['script.' + BRIEFING_SCRIPT];
    const helper = hass?.states[BRIEFING_ENABLED];
    const managedStatus = {
      disabled:'Briefing is off. Enable it in the Family Hub integration settings.',
      forbidden:'You need access to the briefing calendars and forecast.',
      unavailable:'The Family Hub briefing is temporarily unavailable.'
    };
    const legacyConfigured = helper || script || sensor;
    const legacyStatus = !hass ? 'Waiting for Home Assistant…'
      : briefingState?.mode === 'legacy' && !legacyConfigured
        ? 'Set up AI Briefing in the Family Hub integration settings.'
      : !helper || !script || !sensor ? 'Briefing setup is incomplete. Check that the Home Assistant package is loaded.'
      : helper.state === 'off' ? 'Briefing is off. Turn on the Family Hub briefing enabled helper.'
      : helper.state !== 'on' || script.state === 'unavailable' || sensor.state === 'unavailable'
        ? 'Briefing is unavailable. Check the Home Assistant package.' : '';
    const setupStatus = managed ? (managedStatus[briefingState.mode] ?? '') : legacyStatus;
    const shared = managed ? (isToday ? briefingState.briefing : null)
      : (isToday && sensor?.state === day ? sensor.attributes.briefing : null);
    const local = briefingResponse?.day === day ? briefingResponse : null;
    const data = isToday && Date.parse(shared?.generated_at) >= (Date.parse(local?.generated_at) || 0)
      ? shared : local;
    const text = !setupStatus && typeof data?.text === 'string' ? data.text : '';
    const running = Boolean(briefingPending || (managed ? briefingState.pending : script?.state === 'on'));
    const action = section.querySelector('button');
    action.textContent = text ? 'Refresh briefing' : 'Generate briefing';
    action.disabled = running || Boolean(setupStatus);
    action.onclick = () => requestBriefing(day);
    const failed = managed ? briefingState.failure : sensor?.attributes.failure;
    const failure = isToday && failed?.day === day ? failed.status : null;
    const generating = briefingPending === day ||
      (managed ? briefingState.pending === day : isToday && script?.state === 'on' && !briefingPending);
    const empty = isToday ? 'No briefing yet. Wait for the scheduled run or generate one now.'
      : 'No briefing yet. Generate one for this date.';
    const error = briefingError?.day === day ? briefingError.message : failure && briefingFailure(failure);
    const status = setupStatus || (generating ? 'Generating briefing…' : error || (!text ? empty : ''));
    const filter = !setupStatus && selectedCalendar
      ? 'Briefing uses the configured calendars, independent of this filter.' : '';
    const paragraph = section.querySelector('.briefing-text');
    const message = [text, status, filter].filter(Boolean).join('\n');
    if (paragraph.textContent !== message) paragraph.textContent = message;
    const timestamp = section.querySelector('time');
    timestamp.hidden = !text || !Number.isFinite(Date.parse(data?.generated_at));
    if (!timestamp.hidden) {
      timestamp.dateTime = data.generated_at;
      timestamp.textContent = 'Generated ' + briefingTimestamp(new Date(data.generated_at), hass, time.timeZone);
    }
  }

  function updateBriefings() {
    if ((!briefingState || briefingState.mode === 'legacy') && host.hass?.states[BRIEFING_ENABLED]?.state !== 'on') {
      briefingResponse = undefined;
      briefingError = undefined;
    }
    renderBriefing(dayDetails, monthView && selectedDay !== null ? monthDate(month, 0, selectedDay) : null);
    renderBriefing(weekDetails, weekDetails.open ? weekDetailDate : null);
  }

  function briefingFailure(status) {
    if (status === 'busy') return 'A briefing is already running. Try again when it finishes.';
    if (status === 'calendar_error') return briefingState?.mode === 'ready'
      ? 'Briefing could not be updated. Check the calendars in the Family Hub integration settings.'
      : 'Briefing could not be updated. Check the calendar IDs in the package.';
    if (status === 'too_many_events') return 'Briefing could not be updated. This day has too many events.';
    return 'Briefing could not be updated. Check the AI Task entity and Home Assistant logs, then try again.';
  }

  async function requestBriefing(day) {
    if (briefingPending) return;
    briefingPending = day;
    briefingError = undefined;
    updateBriefings();
    const managed = briefingState?.mode === 'ready';
    const revision = briefingState?.revision;
    try {
      const response = managed
        ? await host.hass.callWS({type:'family_hub/briefing/generate', day})
        : (await host.hass.callWS({
          type:'call_service', domain:'script', service:BRIEFING_SCRIPT, return_response:true,
          service_data:{briefing_date:day, force_refresh:true}
        }))?.response;
      if (managed && (briefingState?.mode !== 'ready' || briefingState.revision !== revision)) return;
      if (response?.status !== 'ok' || response.day !== day || typeof response.text !== 'string') {
        briefingError = {day, message:briefingFailure(response?.status)};
        return;
      }
      briefingResponse = response;
    } catch {
      briefingError = {day, message:briefingFailure()};
    } finally {
      briefingPending = undefined;
      updateBriefings();
    }
  }

  function renderCalendar(refreshEvents = true) {
    document.getElementById('week').hidden = monthView;
    document.getElementById('month').hidden = !monthView;
    document.getElementById('week-view').setAttribute('aria-pressed', String(!monthView));
    document.getElementById('month-view').setAttribute('aria-pressed', String(monthView));
    if (!monthView) {
      const label = weekLabel.formatRange(weekStart, weekDates[weekDates.length-1]);
      const title = document.getElementById('week-title');
      if (title.textContent !== label) title.textContent = label;
      weekDays.innerHTML = weekDates.map((date, index) => {
        const forecast = forecasts.get(dateKey(date));
        return `<article class="day${forecast ? ' has-weather' : ''}">
        <button type="button" class="day-heading" data-week-day="${index}" aria-haspopup="dialog" aria-label="View events for ${weekdays[index]} ${date.getUTCDate()}">${weekdays[index]} ${date.getUTCDate()}</button>
        ${forecast ? forecastMarkup(date, index, forecast) : ''}
        <div class="events">${eventCards(eventsOn(date))}</div>
      </article>`;
      }).join('');
      if (weekDetails.open && weekDetailDate) {
        renderDetailWeather(document.getElementById('week-day-weather'), weekDetailDate);
        if (refreshEvents) {
          renderDaySchedule(weekDetails, weekDetailDate, document.getElementById('week-day-title'),
            document.getElementById('week-day-events'));
        }
      }
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
    const date = selectedDay === null ? null : monthDate(month, 0, selectedDay);
    renderDetailWeather(weather, date);
    if (!date) return;
    if (refreshEvents) {
      renderDaySchedule(dayDetails, date, document.getElementById('day-title'), document.getElementById('day-events'));
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
      weekDetailDate = weekDates[Number(dayButton.dataset.weekDay)];
      renderDetailWeather(document.getElementById('week-day-weather'), weekDetailDate);
      renderDaySchedule(weekDetails, weekDetailDate, document.getElementById('week-day-title'),
        document.getElementById('week-day-events'));
      weekDetails.showModal();
      weekDetails.scrollTop = 0;
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
    document.getElementById('day-scroll').scrollTop = 0;
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
  for (const [id, direction] of [['previous-week', -1], ['current-week', 0], ['next-week', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
      const start = addDays(weekStart, direction * 7);
      browsedWeek = direction && +start !== +currentWeek() ? start : null;
      loadCalendar();
    });
  }
  for (const [id, direction] of [['previous-month', -1], ['next-month', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
      month = monthDate(month, direction);
      selectedDay = null;
      calendarEvents = [];
      loadCalendar();
    });
  }
  return {loadCalendar, updateEntities, updateWidgets, startWeather, stop() {
    request++;
    window.clearTimeout(retryTimer);
    stopWeather();
    stopBriefingSubscription();
    assistant.stop();
  }};
}

class FamilyHubLiveEditor extends HTMLElement {
  setConfig(config) {
    const {title: _legacyTitle, ...editorConfig} = config;
    this.config = editorConfig;
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
      ['default_view','Calendar opens in',{week:'Week',month:'Month',month_details:'Month with details'}],
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

    const appearance = document.createElement('fieldset');
    const appearanceHeading = document.createElement('legend');
    appearanceHeading.textContent = 'Calendar appearance';
    appearance.append(appearanceHeading);
    for (const [key, title] of [['frame','Frame'], ['seasonal_accent','Seasonal accent']]) {
      const row = document.createElement('p');
      const label = document.createElement('label');
      const picker = document.createElement('select');
      for (const [value, name] of Object.entries(APPEARANCE_OPTIONS[key])) picker.add(new Option(name, value));
      picker.value = normalized.appearance[key];
      picker.onchange = () => save('appearance', {
        ...(isRecord(this.config.appearance) ? this.config.appearance : {}),
        [key]:picker.value
      });
      label.append(title+' ', picker);
      row.append(label);
      appearance.append(row);
    }
    this.append(appearance);

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
    root.innerHTML = markup(this.config.appearance);
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

// Static flat Meteocons from @meteocons/svg-static 0.1.0. Embedded so the card and
// standalone preview use the same icons without loading separate resources.
/*
MIT License

Copyright (c) 2020-present Bas Milius

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const WEATHER_ICONS = new Map([
  ['sunny', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Zz48Zz48Y2lyY2xlIGN4PSI2NCIgY3k9IjYzLjk5OTkiIHI9IjIwIiBmaWxsPSIjRjhBRjE4Ii8+PGc+PHBhdGggZD0iTTYxIDE5QzYxIDE3LjM0MzEgNjIuMzQzMSAxNiA2NCAxNkM2NS42NTY4IDE2IDY3IDE3LjM0MzEgNjcgMTlWMzNDNjcgMzQuNjU2OSA2NS42NTY4IDM2IDY0IDM2QzYyLjM0MzEgMzYgNjEgMzQuNjU2OSA2MSAzM1YxOVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNOTMuNjk4NSAzMC4wNTg5Qzk0Ljg3IDI4Ljg4NzMgOTYuNzY5NiAyOC44ODczIDk3Ljk0MTEgMzAuMDU4OUM5OS4xMTI3IDMxLjIzMDQgOTkuMTEyNyAzMy4xMjk5IDk3Ljk0MTEgMzQuMzAxNUw4OC4wNDE2IDQ0LjIwMUM4Ni44NzAxIDQ1LjM3MjYgODQuOTcwNiA0NS4zNzI2IDgzLjc5OSA0NC4yMDFDODIuNjI3NCA0My4wMjk0IDgyLjYyNzQgNDEuMTI5OSA4My43OTkgMzkuOTU4NEw5My42OTg1IDMwLjA1ODlaIiBmaWxsPSIjRjhBRjE4Ii8+PHBhdGggZD0iTTEwOSA2MUMxMTAuNjU3IDYxIDExMiA2Mi4zNDMyIDExMiA2NEMxMTIgNjUuNjU2OSAxMTAuNjU3IDY3IDEwOSA2N0g5NUM5My4zNDMxIDY3IDkyIDY1LjY1NjkgOTIgNjRDOTIgNjIuMzQzMiA5My4zNDMxIDYxIDk1IDYxSDEwOVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNOTcuOTQxMSA5My42OTg1Qzk5LjExMjcgOTQuODcwMSA5OS4xMTI3IDk2Ljc2OTYgOTcuOTQxMSA5Ny45NDExQzk2Ljc2OTYgOTkuMTEyNyA5NC44NzAxIDk5LjExMjcgOTMuNjk4NSA5Ny45NDExTDgzLjc5OSA4OC4wNDE2QzgyLjYyNzQgODYuODcwMSA4Mi42Mjc0IDg0Ljk3MDYgODMuNzk5IDgzLjc5OUM4NC45NzA2IDgyLjYyNzQgODYuODcwMSA4Mi42Mjc0IDg4LjA0MTYgODMuNzk5TDk3Ljk0MTEgOTMuNjk4NVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNNjEgOTVDNjEgOTMuMzQzMSA2Mi4zNDMxIDkyIDY0IDkyQzY1LjY1NjggOTIgNjcgOTMuMzQzMSA2NyA5NVYxMDlDNjcgMTEwLjY1NyA2NS42NTY4IDExMiA2NCAxMTJDNjIuMzQzMSAxMTIgNjEgMTEwLjY1NyA2MSAxMDlWOTVaIiBmaWxsPSIjRjhBRjE4Ii8+PHBhdGggZD0iTTM5Ljk1ODQgODMuNzk5QzQxLjEyOTkgODIuNjI3NCA0My4wMjk0IDgyLjYyNzQgNDQuMjAxIDgzLjc5OUM0NS4zNzI2IDg0Ljk3MDYgNDUuMzcyNiA4Ni44NzAxIDQ0LjIwMSA4OC4wNDE2TDM0LjMwMTUgOTcuOTQxMUMzMy4xMjk5IDk5LjExMjcgMzEuMjMwNCA5OS4xMTI3IDMwLjA1ODkgOTcuOTQxMUMyOC44ODczIDk2Ljc2OTYgMjguODg3MyA5NC44NyAzMC4wNTg5IDkzLjY5ODVMMzkuOTU4NCA4My43OTlaIiBmaWxsPSIjRjhBRjE4Ii8+PHBhdGggZD0iTTMzIDYxQzM0LjY1NjkgNjEgMzYgNjIuMzQzMSAzNiA2NEMzNiA2NS42NTY4IDM0LjY1NjkgNjcgMzMgNjdIMTlDMTcuMzQzMSA2NyAxNiA2NS42NTY4IDE2IDY0QzE2IDYyLjM0MzEgMTcuMzQzMSA2MSAxOSA2MUgzM1oiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNNDQuMjAxIDM5Ljk1ODRDNDUuMzcyNiA0MS4xMjk5IDQ1LjM3MjYgNDMuMDI5NCA0NC4yMDEgNDQuMjAxQzQzLjAyOTQgNDUuMzcyNiA0MS4xMjk5IDQ1LjM3MjYgMzkuOTU4NCA0NC4yMDFMMzAuMDU4OSAzNC4zMDE1QzI4Ljg4NzMgMzMuMTI5OSAyOC44ODczIDMxLjIzMDUgMzAuMDU4OSAzMC4wNTg5QzMxLjIzMDUgMjguODg3MyAzMy4xMjk5IDI4Ljg4NzMgMzQuMzAxNSAzMC4wNTg5TDQ0LjIwMSAzOS45NTg0WiIgZmlsbD0iI0Y4QUYxOCIvPjwvZz48L2c+PC9nPjwvc3ZnPg=='], // clear-day.svg
  ['clear-night', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Zz48Zz48cGF0aCBkPSJNNjAuOTYyNCAzMkM0NC42NzY0IDMzLjc1NzYgMzIgNDcuMzYyNCAzMiA2My44OTgyQzMyIDgxLjYyNjcgNDYuNTY3MyA5NiA2NC41MzU4IDk2Qzc5LjY4MjQgOTYgOTIuMzczMyA4NS43NzQ1IDk2IDcxLjk0OTFDNzQuMzgxIDc0LjI2NyA1NS4zMjg4IDUzLjQ2NDMgNjAuOTYyNCAzMloiIGZpbGw9IiM3MkI5RDUiLz48L2c+PC9nPjwvc3ZnPg=='], // clear-night.svg
  ['partlycloudy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0icGFydGx5LWNsb3VkeS1kYXkiIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8yMDQ1XzM5NTY3KSI+PGcgaWQ9IlNreSI+PGcgaWQ9Ik1hc2sgZ3JvdXAiPjxtYXNrIGlkPSJtYXNrMF8yMDQ1XzM5NTY3IiBzdHlsZT0ibWFzay10eXBlOmFscGhhIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCI+PGcgaWQ9IkNsb3VkIE1hc2siPjxwYXRoIGlkPSJTdWJ0cmFjdCIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMjggMEgwVjEyOEgxMjhWMFpNMzcuOTUxOSA5M0g5MC45NzUyQzEwMC4yMjcgOTMgMTA3Ljk5OCA4NS4zNTMgMTA3Ljk5OCA3Ni4wMjgxQzEwNy45OTggNjguMDIxNyAxMDIuMzA1IDYxLjM1MDEgOTQuOTI0OCA1OS41NTEyQzk1LjM2MTkgNDkuOTAwNSA4OS42NzQ0IDQwLjYwOTMgODAuNTUwOSAzNi43OTIyQzcxLjEwNzEgMzIuODQxMSA2MC4wNjY0IDM1LjYxMTkgNTMuNTMwNSA0My4yMzg0QzQ4LjU3MDIgNDEuNTk1NiA0Mi45ODE1IDQyLjI5NTcgMzguNTc0MSA0NS4yOTA3QzM0LjE0NTkgNDguMjk5OCAzMS40MzA1IDUzLjI4MDkgMzEuMTg0NiA1OC41Mzc5QzI0LjA2MzMgNjEuNDYzIDE5LjMyNzggNjguODUwNiAyMC4wNzc2IDc2Ljc4MzlDMjAuOTQyIDg1LjkyOTUgMjguODI4NSA5My4wMDE4IDM3Ljk1MTkgOTNaIiBmaWxsPSJibGFjayIvPjwvZz48L21hc2s+PGcgbWFzaz0idXJsKCNtYXNrMF8yMDQ1XzM5NTY3KSI+PGcgaWQ9IlN1biI+PGNpcmNsZSBpZD0iQ29yZSIgY3g9IjM5IiBjeT0iNTEiIHI9IjkiIGZpbGw9IiNGOEFGMTgiLz48ZyBpZD0iUmF5cyI+PHBhdGggZD0iTTM3LjY4NzUgMzEuMzEyNUMzNy42ODc1IDMwLjU4NzYgMzguMjc1MSAzMCAzOSAzMEMzOS43MjQ5IDMwIDQwLjMxMjUgMzAuNTg3NiA0MC4zMTI1IDMxLjMxMjVWMzcuNDM3NUM0MC4zMTI1IDM4LjE2MjQgMzkuNzI0OSAzOC43NSAzOSAzOC43NUMzOC4yNzUxIDM4Ljc1IDM3LjY4NzUgMzguMTYyNCAzNy42ODc1IDM3LjQzNzVWMzEuMzEyNVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNNTEuOTkzMSAzNi4xNTA4QzUyLjUwNTYgMzUuNjM4MiA1My4zMzY3IDM1LjYzODIgNTMuODQ5MiAzNi4xNTA4QzU0LjM2MTggMzYuNjYzMyA1NC4zNjE4IDM3LjQ5NDMgNTMuODQ5MiAzOC4wMDY5TDQ5LjUxODIgNDIuMzM3OUM0OS4wMDU2IDQyLjg1MDUgNDguMTc0NiA0Mi44NTA1IDQ3LjY2MjEgNDIuMzM3OUM0Ny4xNDk1IDQxLjgyNTQgNDcuMTQ5NSA0MC45OTQ0IDQ3LjY2MjEgNDAuNDgxOEw1MS45OTMxIDM2LjE1MDhaIiBmaWxsPSIjRjhBRjE4Ii8+PHBhdGggZD0iTTU4LjY4NzUgNDkuNjg3NUM1OS40MTI0IDQ5LjY4NzUgNjAgNTAuMjc1MSA2MCA1MUM2MCA1MS43MjQ5IDU5LjQxMjQgNTIuMzEyNSA1OC42ODc1IDUyLjMxMjVINTIuNTYyNUM1MS44Mzc2IDUyLjMxMjUgNTEuMjUgNTEuNzI0OSA1MS4yNSA1MUM1MS4yNSA1MC4yNzUxIDUxLjgzNzYgNDkuNjg3NSA1Mi41NjI1IDQ5LjY4NzVINTguNjg3NVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNNTMuODQ5MiA2My45OTMxQzU0LjM2MTggNjQuNTA1NyA1NC4zNjE4IDY1LjMzNjcgNTMuODQ5MiA2NS44NDkyQzUzLjMzNjcgNjYuMzYxOCA1Mi41MDU2IDY2LjM2MTggNTEuOTkzMSA2NS44NDkyTDQ3LjY2MjEgNjEuNTE4MkM0Ny4xNDk1IDYxLjAwNTcgNDcuMTQ5NSA2MC4xNzQ2IDQ3LjY2MjEgNTkuNjYyMUM0OC4xNzQ2IDU5LjE0OTUgNDkuMDA1NyA1OS4xNDk1IDQ5LjUxODIgNTkuNjYyMUw1My44NDkyIDYzLjk5MzFaIiBmaWxsPSIjRjhBRjE4Ii8+PHBhdGggZD0iTTM3LjY4NzUgNjQuNTYyNUMzNy42ODc1IDYzLjgzNzYgMzguMjc1MSA2My4yNSAzOSA2My4yNUMzOS43MjQ5IDYzLjI1IDQwLjMxMjUgNjMuODM3NiA0MC4zMTI1IDY0LjU2MjVWNzAuNjg3NUM0MC4zMTI1IDcxLjQxMjQgMzkuNzI0OSA3MiAzOSA3MkMzOC4yNzUxIDcyIDM3LjY4NzUgNzEuNDEyNCAzNy42ODc1IDcwLjY4NzVWNjQuNTYyNVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNMjguNDgxOCA1OS42NjIxQzI4Ljk5NDMgNTkuMTQ5NSAyOS44MjU0IDU5LjE0OTUgMzAuMzM3OSA1OS42NjIxQzMwLjg1MDUgNjAuMTc0NiAzMC44NTA1IDYxLjAwNTYgMzAuMzM3OSA2MS41MTgyTDI2LjAwNjkgNjUuODQ5MkMyNS40OTQzIDY2LjM2MTggMjQuNjYzMyA2Ni4zNjE4IDI0LjE1MDggNjUuODQ5MkMyMy42MzgyIDY1LjMzNjcgMjMuNjM4MiA2NC41MDU2IDI0LjE1MDggNjMuOTkzMUwyOC40ODE4IDU5LjY2MjFaIiBmaWxsPSIjRjhBRjE4Ii8+PHBhdGggZD0iTTI1LjQzNzUgNDkuNjg3NUMyNi4xNjI0IDQ5LjY4NzUgMjYuNzUgNTAuMjc1MSAyNi43NSA1MUMyNi43NSA1MS43MjQ5IDI2LjE2MjQgNTIuMzEyNSAyNS40Mzc1IDUyLjMxMjVIMTkuMzEyNUMxOC41ODc2IDUyLjMxMjUgMTggNTEuNzI0OSAxOCA1MUMxOCA1MC4yNzUxIDE4LjU4NzYgNDkuNjg3NSAxOS4zMTI1IDQ5LjY4NzVIMjUuNDM3NVoiIGZpbGw9IiNGOEFGMTgiLz48cGF0aCBkPSJNMzAuMzM3OSA0MC40ODE4QzMwLjg1MDUgNDAuOTk0NCAzMC44NTA1IDQxLjgyNTQgMzAuMzM3OSA0Mi4zMzc5QzI5LjgyNTQgNDIuODUwNSAyOC45OTQ0IDQyLjg1MDUgMjguNDgxOCA0Mi4zMzc5TDI0LjE1MDggMzguMDA2OUMyMy42MzgyIDM3LjQ5NDQgMjMuNjM4MiAzNi42NjMzIDI0LjE1MDggMzYuMTUwOEMyNC42NjMzIDM1LjYzODIgMjUuNDk0NCAzNS42MzgyIDI2LjAwNjkgMzYuMTUwOEwzMC4zMzc5IDQwLjQ4MThaIiBmaWxsPSIjRjhBRjE4Ii8+PC9nPjwvZz48L2c+PC9nPjxnIGlkPSJDbG91ZHMiPjxnIGlkPSJDbG91ZCI+PHBhdGggaWQ9IkNsb3VkXzIiIGQ9Ik05MC4zODg2IDYzLjA4NTZDOTIuNjgzOCA1My44ODE5IDg3Ljc0MDggNDQuMTM1NyA3OS4wMDg1IDQwLjQ4MjJDNzAuMjY1MyAzNi44MjQyIDU5LjgyNzcgNDAuMTM3NSA1NC44MzcyIDQ4LjIxMTVDNTAuNTM2MyA0NS42MjUgNDQuOTc1MiA0NS43NzgxIDQwLjgyMzkgNDguNTk5MUMzNi42ODMyIDUxLjQxMjggMzQuNDk5NiA1Ni41MTQzIDM1LjM0OTkgNjEuNDUzOUMyOC4zOTI2IDYyLjc2ODUgMjMuMzkzNCA2OS4zMzkzIDI0LjA2MTQgNzYuNDA3NkMyNC43Mjk3IDgzLjQ3NzYgMzAuODcxOCA4OS4wMDE4IDM3Ljk1MzQgODlDNTUuNjA2NiA4OSA3My4zMDYgODkgOTAuOTc2NyA4OUM5OC4wNDQ2IDg5IDEwNCA4My4xMTg5IDEwNCA3Ni4wMjgxQzEwNCA2OC43MDE1IDk3LjY3NzUgNjIuNzY3NCA5MC4zODg2IDYzLjA4NTZaIiBmaWxsPSIjRTZFRkZDIi8+PC9nPjwvZz48L2c+PC9nPjxkZWZzPjxjbGlwUGF0aCBpZD0iY2xpcDBfMjA0NV8zOTU2NyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IndoaXRlIi8+PC9jbGlwUGF0aD48L2RlZnM+PC9zdmc+'], // partly-cloudy-day.svg
  ['cloudy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0ib3ZlcmNhc3QiIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8yMDQ1XzM5NTcxKSI+PGcgaWQ9IlNreSI+PGcgaWQ9IkNsb3VkcyIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAxXzIwNDVfMzk1NzEpIj48ZyBpZD0iTWFzayBncm91cCI+PG1hc2sgaWQ9Im1hc2swXzIwNDVfMzk1NzEiIHN0eWxlPSJtYXNrLXR5cGU6YWxwaGEiIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9IjAiIHk9IjAiIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48ZyBpZD0iQ2xvdWQgTWFzayI+PHBhdGggaWQ9IlN1YnRyYWN0IiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEyOCAwSDBWMTI4SDEyOFYwWk0zNy45NTE5IDkzSDkwLjk3NTJDMTAwLjIyNyA5MyAxMDcuOTk4IDg1LjM1MyAxMDcuOTk4IDc2LjAyODFDMTA3Ljk5OCA2OC4wMjE3IDEwMi4zMDUgNjEuMzUwMSA5NC45MjQ4IDU5LjU1MTJDOTUuMzYxOSA0OS45MDA1IDg5LjY3NDQgNDAuNjA5MyA4MC41NTA5IDM2Ljc5MjJDNzEuMTA3MSAzMi44NDExIDYwLjA2NjQgMzUuNjExOSA1My41MzA1IDQzLjIzODRDNDguNTcwMiA0MS41OTU2IDQyLjk4MTUgNDIuMjk1NyAzOC41NzQxIDQ1LjI5MDdDMzQuMTQ1OSA0OC4yOTk4IDMxLjQzMDUgNTMuMjgwOSAzMS4xODQ2IDU4LjUzNzlDMjQuMDYzMyA2MS40NjMgMTkuMzI3OCA2OC44NTA2IDIwLjA3NzYgNzYuNzgzOUMyMC45NDIgODUuOTI5NSAyOC44Mjg1IDkzLjAwMTggMzcuOTUxOSA5M1oiIGZpbGw9ImJsYWNrIi8+PC9nPjwvbWFzaz48ZyBtYXNrPSJ1cmwoI21hc2swXzIwNDVfMzk1NzEpIj48ZyBpZD0iU2Vjb25kYXJ5IENsb3VkIj48cGF0aCBpZD0iQ2xvdWQiIGQ9Ik0xMDEuMTk0IDU1LjU2MjFDMTAyLjM2NyA1MS4wNSA5OS43NjAyIDQ2LjQyMjUgOTUuNTA0MyA0NC43MTMzQzkxLjE5MTkgNDIuOTgxMyA4NS45NjEyIDQ0LjQ3NDMgODMuNDE4NiA0OC40MjNDODEuMjY0OCA0Ny4xNzk3IDc4LjQ5NiA0Ny4yNDk2IDc2LjQxMTkgNDguNjA5Qzc0LjM4MDggNDkuOTM0IDczLjI0MzQgNTIuMzcyIDczLjY3NSA1NC43Nzg5QzcwLjI5OTggNTUuMzkxMSA2Ny42ODc0IDU4LjQ2ODggNjguMDMwNyA2MS45NTYxQzY4LjM3NDggNjUuNDUxMSA3MS41Mzk0IDY4LjAwMDggNzQuOTc2NyA2OEM4My44MTI2IDY4IDkyLjY1MTQgNjcuOTkyNSAxMDEuNDg4IDY4QzEwNC45MTEgNjggMTA4IDY1LjI4NDkgMTA4IDYxLjc3NEMxMDggNTguMTQyOCAxMDQuNzIxIDU1LjQxNDIgMTAxLjE5NCA1NS41NjIxWiIgZmlsbD0iI0IwQkNDRCIvPjwvZz48L2c+PC9nPjxnIGlkPSJDbG91ZF8yIj48cGF0aCBpZD0iQ2xvdWRfMyIgZD0iTTkwLjM4ODYgNjMuMDg1NkM5Mi42ODM4IDUzLjg4MTkgODcuNzQwOCA0NC4xMzU3IDc5LjAwODUgNDAuNDgyMkM3MC4yNjUzIDM2LjgyNDIgNTkuODI3NyA0MC4xMzc1IDU0LjgzNzIgNDguMjExNUM1MC41MzYzIDQ1LjYyNSA0NC45NzUyIDQ1Ljc3ODEgNDAuODIzOSA0OC41OTkxQzM2LjY4MzIgNTEuNDEyOCAzNC40OTk2IDU2LjUxNDMgMzUuMzQ5OSA2MS40NTM5QzI4LjM5MjYgNjIuNzY4NSAyMy4zOTM0IDY5LjMzOTMgMjQuMDYxNCA3Ni40MDc2QzI0LjcyOTcgODMuNDc3NiAzMC44NzE4IDg5LjAwMTggMzcuOTUzNCA4OUM1NS42MDY2IDg5IDczLjMwNiA4OSA5MC45NzY3IDg5Qzk4LjA0NDYgODkgMTA0IDgzLjExODkgMTA0IDc2LjAyODFDMTA0IDY4LjcwMTUgOTcuNjc3NSA2Mi43Njc0IDkwLjM4ODYgNjMuMDg1NloiIGZpbGw9IiNFNkVGRkMiLz48L2c+PC9nPjwvZz48L2c+PGRlZnM+PGNsaXBQYXRoIGlkPSJjbGlwMF8yMDQ1XzM5NTcxIj48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjxjbGlwUGF0aCBpZD0iY2xpcDFfMjA0NV8zOTU3MSI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IndoaXRlIi8+PC9jbGlwUGF0aD48L2RlZnM+PC9zdmc+'], // overcast.svg
  ['rainy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0ib3ZlcmNhc3QtcmFpbiIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzIwNDVfMzk1OTYpIj48ZyBpZD0iU2t5Ij48ZyBpZD0iQ2xvdWRzIiBjbGlwLXBhdGg9InVybCgjY2xpcDFfMjA0NV8zOTU5NikiPjxnIGlkPSJNYXNrIGdyb3VwIj48bWFzayBpZD0ibWFzazBfMjA0NV8zOTU5NiIgc3R5bGU9Im1hc2stdHlwZTphbHBoYSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMCIgeT0iMCIgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiPjxnIGlkPSJDbG91ZCBNYXNrIj48cGF0aCBpZD0iU3VidHJhY3QiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTI4IDBIMFYxMjhIMTI4VjBaTTM3Ljk1MTkgOTNIOTAuOTc1MkMxMDAuMjI3IDkzIDEwNy45OTggODUuMzUzIDEwNy45OTggNzYuMDI4MUMxMDcuOTk4IDY4LjAyMTcgMTAyLjMwNSA2MS4zNTAxIDk0LjkyNDggNTkuNTUxMkM5NS4zNjE5IDQ5LjkwMDUgODkuNjc0NCA0MC42MDkzIDgwLjU1MDkgMzYuNzkyMkM3MS4xMDcxIDMyLjg0MTEgNjAuMDY2NCAzNS42MTE5IDUzLjUzMDUgNDMuMjM4NEM0OC41NzAyIDQxLjU5NTYgNDIuOTgxNSA0Mi4yOTU3IDM4LjU3NDEgNDUuMjkwN0MzNC4xNDU5IDQ4LjI5OTggMzEuNDMwNSA1My4yODA5IDMxLjE4NDYgNTguNTM3OUMyNC4wNjMzIDYxLjQ2MyAxOS4zMjc4IDY4Ljg1MDYgMjAuMDc3NiA3Ni43ODM5QzIwLjk0MiA4NS45Mjk1IDI4LjgyODUgOTMuMDAxOCAzNy45NTE5IDkzWiIgZmlsbD0iYmxhY2siLz48L2c+PC9tYXNrPjxnIG1hc2s9InVybCgjbWFzazBfMjA0NV8zOTU5NikiPjxnIGlkPSJTZWNvbmRhcnkgQ2xvdWQiPjxwYXRoIGlkPSJDbG91ZCIgZD0iTTEwMS4xOTQgNTUuNTYyMUMxMDIuMzY3IDUxLjA1IDk5Ljc2MDIgNDYuNDIyNSA5NS41MDQzIDQ0LjcxMzNDOTEuMTkxOSA0Mi45ODEzIDg1Ljk2MTIgNDQuNDc0MyA4My40MTg2IDQ4LjQyM0M4MS4yNjQ4IDQ3LjE3OTcgNzguNDk2IDQ3LjI0OTYgNzYuNDExOSA0OC42MDlDNzQuMzgwOCA0OS45MzQgNzMuMjQzNCA1Mi4zNzIgNzMuNjc1IDU0Ljc3ODlDNzAuMjk5OCA1NS4zOTExIDY3LjY4NzQgNTguNDY4OCA2OC4wMzA3IDYxLjk1NjFDNjguMzc0OCA2NS40NTExIDcxLjUzOTQgNjguMDAwOCA3NC45NzY3IDY4QzgzLjgxMjYgNjggOTIuNjUxNCA2Ny45OTI1IDEwMS40ODggNjhDMTA0LjkxMSA2OCAxMDggNjUuMjg0OSAxMDggNjEuNzc0QzEwOCA1OC4xNDI4IDEwNC43MjEgNTUuNDE0MiAxMDEuMTk0IDU1LjU2MjFaIiBmaWxsPSIjQjBCQ0NEIi8+PC9nPjwvZz48L2c+PGcgaWQ9IkNsb3VkXzIiPjxwYXRoIGlkPSJDbG91ZF8zIiBkPSJNOTAuMzg4NiA2My4wODU2QzkyLjY4MzggNTMuODgxOSA4Ny43NDA4IDQ0LjEzNTcgNzkuMDA4NSA0MC40ODIyQzcwLjI2NTMgMzYuODI0MiA1OS44Mjc3IDQwLjEzNzUgNTQuODM3MiA0OC4yMTE1QzUwLjUzNjMgNDUuNjI1IDQ0Ljk3NTIgNDUuNzc4MSA0MC44MjM5IDQ4LjU5OTFDMzYuNjgzMiA1MS40MTI4IDM0LjQ5OTYgNTYuNTE0MyAzNS4zNDk5IDYxLjQ1MzlDMjguMzkyNiA2Mi43Njg1IDIzLjM5MzQgNjkuMzM5MyAyNC4wNjE0IDc2LjQwNzZDMjQuNzI5NyA4My40Nzc2IDMwLjg3MTggODkuMDAxOCAzNy45NTM0IDg5QzU1LjYwNjYgODkgNzMuMzA2IDg5IDkwLjk3NjcgODlDOTguMDQ0NiA4OSAxMDQgODMuMTE4OSAxMDQgNzYuMDI4MUMxMDQgNjguNzAxNSA5Ny42Nzc1IDYyLjc2NzQgOTAuMzg4NiA2My4wODU2WiIgZmlsbD0iI0U2RUZGQyIvPjwvZz48L2c+PC9nPjxnIGlkPSJQcmVjaXBpdGF0aW9uIj48ZyBpZD0iUmFpbmRyb3BzIj48cGF0aCBpZD0iUmFpbmRyb3AgMSIgZD0iTTUyIDgzVjk1IiBzdHJva2U9IiMwQTVBRDQiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLCA4KSIvPjxwYXRoIGlkPSJSYWluZHJvcCAyIiBkPSJNNjQgODNWOTUiIHN0cm9rZT0iIzBBNUFENCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAsIDApIi8+PHBhdGggaWQ9IlJhaW5kcm9wIDMiIGQ9Ik03NiA4M1Y5NSIgc3Ryb2tlPSIjMEE1QUQ0IiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgOCkiLz48L2c+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfMzk1OTYiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PGNsaXBQYXRoIGlkPSJjbGlwMV8yMDQ1XzM5NTk2Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4='], // overcast-rain.svg
  ['pouring', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0iZXh0cmVtZS1yYWluIiBjbGlwLXBhdGg9InVybCgjY2xpcDBfMjA0NV8zOTYwNSkiPjxnIGlkPSJTa3kiPjxnIGlkPSJDbG91ZHMiIGNsaXAtcGF0aD0idXJsKCNjbGlwMV8yMDQ1XzM5NjA1KSI+PGcgaWQ9Ik1hc2sgZ3JvdXAiPjxtYXNrIGlkPSJtYXNrMF8yMDQ1XzM5NjA1IiBzdHlsZT0ibWFzay10eXBlOmFscGhhIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCI+PGcgaWQ9IkNsb3VkIE1hc2siPjxwYXRoIGlkPSJTdWJ0cmFjdCIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMjggMEgwVjEyOEgxMjhWMFpNMzcuOTUxOSA5M0g5MC45NzUyQzEwMC4yMjcgOTMgMTA3Ljk5OCA4NS4zNTMgMTA3Ljk5OCA3Ni4wMjgxQzEwNy45OTggNjguMDIxNyAxMDIuMzA1IDYxLjM1MDEgOTQuOTI0OCA1OS41NTEyQzk1LjM2MTkgNDkuOTAwNSA4OS42NzQ0IDQwLjYwOTMgODAuNTUwOSAzNi43OTIyQzcxLjEwNzEgMzIuODQxMSA2MC4wNjY0IDM1LjYxMTkgNTMuNTMwNSA0My4yMzg0QzQ4LjU3MDIgNDEuNTk1NiA0Mi45ODE1IDQyLjI5NTcgMzguNTc0MSA0NS4yOTA3QzM0LjE0NTkgNDguMjk5OCAzMS40MzA1IDUzLjI4MDkgMzEuMTg0NiA1OC41Mzc5QzI0LjA2MzMgNjEuNDYzIDE5LjMyNzggNjguODUwNiAyMC4wNzc2IDc2Ljc4MzlDMjAuOTQyIDg1LjkyOTUgMjguODI4NSA5My4wMDE4IDM3Ljk1MTkgOTNaIiBmaWxsPSJibGFjayIvPjwvZz48L21hc2s+PGcgbWFzaz0idXJsKCNtYXNrMF8yMDQ1XzM5NjA1KSI+PGcgaWQ9IlNlY29uZGFyeSBDbG91ZCI+PHBhdGggaWQ9IkNsb3VkIiBkPSJNMTAxLjE5NCA1NS41NjIxQzEwMi4zNjcgNTEuMDUgOTkuNzYwMiA0Ni40MjI1IDk1LjUwNDMgNDQuNzEzM0M5MS4xOTE5IDQyLjk4MTMgODUuOTYxMiA0NC40NzQzIDgzLjQxODYgNDguNDIzQzgxLjI2NDggNDcuMTc5NyA3OC40OTYgNDcuMjQ5NiA3Ni40MTE5IDQ4LjYwOUM3NC4zODA4IDQ5LjkzNCA3My4yNDM0IDUyLjM3MiA3My42NzUgNTQuNzc4OUM3MC4yOTk4IDU1LjM5MTEgNjcuNjg3NCA1OC40Njg4IDY4LjAzMDcgNjEuOTU2MUM2OC4zNzQ4IDY1LjQ1MTEgNzEuNTM5NCA2OC4wMDA4IDc0Ljk3NjcgNjhDODMuODEyNiA2OCA5Mi42NTE0IDY3Ljk5MjUgMTAxLjQ4OCA2OEMxMDQuOTExIDY4IDEwOCA2NS4yODQ5IDEwOCA2MS43NzRDMTA4IDU4LjE0MjggMTA0LjcyMSA1NS40MTQyIDEwMS4xOTQgNTUuNTYyMVoiIGZpbGw9IiNCMEJDQ0QiLz48L2c+PC9nPjwvZz48ZyBpZD0iQ2xvdWRfMiI+PHBhdGggaWQ9IkNsb3VkXzMiIGQ9Ik05MC4zODg2IDYzLjA4NTZDOTIuNjgzOCA1My44ODE5IDg3Ljc0MDggNDQuMTM1NyA3OS4wMDg1IDQwLjQ4MjJDNzAuMjY1MyAzNi44MjQyIDU5LjgyNzcgNDAuMTM3NSA1NC44MzcyIDQ4LjIxMTVDNTAuNTM2MyA0NS42MjUgNDQuOTc1MiA0NS43NzgxIDQwLjgyMzkgNDguNTk5MUMzNi42ODMyIDUxLjQxMjggMzQuNDk5NiA1Ni41MTQzIDM1LjM0OTkgNjEuNDUzOUMyOC4zOTI2IDYyLjc2ODUgMjMuMzkzNCA2OS4zMzkzIDI0LjA2MTQgNzYuNDA3NkMyNC43Mjk3IDgzLjQ3NzYgMzAuODcxOCA4OS4wMDE4IDM3Ljk1MzQgODlDNTUuNjA2NiA4OSA3My4zMDYgODkgOTAuOTc2NyA4OUM5OC4wNDQ2IDg5IDEwNCA4My4xMTg5IDEwNCA3Ni4wMjgxQzEwNCA2OC43MDE1IDk3LjY3NzUgNjIuNzY3NCA5MC4zODg2IDYzLjA4NTZaIiBmaWxsPSIjN0M4Q0EyIi8+PC9nPjwvZz48L2c+PGcgaWQ9IlByZWNpcGl0YXRpb24iPjxnIGlkPSJSYWluZHJvcHMiPjxwYXRoIGlkPSJSYWluZHJvcCAxIiBkPSJNNTIgODNWOTUiIHN0cm9rZT0iIzBBNUFENCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAsIDgpIi8+PHBhdGggaWQ9IlJhaW5kcm9wIDIiIGQ9Ik02NCA4M1Y5NSIgc3Ryb2tlPSIjMEE1QUQ0IiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgMCkiLz48cGF0aCBpZD0iUmFpbmRyb3AgMyIgZD0iTTc2IDgzVjk1IiBzdHJva2U9IiMwQTVBRDQiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLCA4KSIvPjwvZz48L2c+PC9nPjxkZWZzPjxjbGlwUGF0aCBpZD0iY2xpcDBfMjA0NV8zOTYwNSI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IndoaXRlIi8+PC9jbGlwUGF0aD48Y2xpcFBhdGggaWQ9ImNsaXAxXzIwNDVfMzk2MDUiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg=='], // extreme-rain.svg
  ['lightning', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0idGh1bmRlcnN0b3JtcyIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzIwNDVfMzk4NTEpIj48ZyBpZD0iU2t5Ij48ZyBpZD0iQ2xvdWRzIj48ZyBpZD0iQ2xvdWQiPjxwYXRoIGlkPSJDbG91ZF8yIiBkPSJNOTAuMzg4NyA2My4wODU2QzkyLjY4NCA1My44ODE5IDg3Ljc0MSA0NC4xMzU3IDc5LjAwODcgNDAuNDgyMkM3MC4yNjU0IDM2LjgyNDIgNTkuODI3OCA0MC4xMzc1IDU0LjgzNzMgNDguMjExNUM1MC41MzY0IDQ1LjYyNSA0NC45NzUzIDQ1Ljc3ODEgNDAuODI0IDQ4LjU5OTFDMzYuNjgzMyA1MS40MTI4IDM0LjQ5OTggNTYuNTE0MyAzNS4zNSA2MS40NTM5QzI4LjM5MjcgNjIuNzY4NSAyMy4zOTM1IDY5LjMzOTMgMjQuMDYxNiA3Ni40MDc2QzI0LjcyOTggODMuNDc3NiAzMC44NzIgODkuMDAxOCAzNy45NTM1IDg5QzU1LjYwNjcgODkgNzMuMzA2MSA4OSA5MC45NzY4IDg5Qzk4LjA0NDcgODkgMTA0IDgzLjExODkgMTA0IDc2LjAyODFDMTA0IDY4LjcwMTUgOTcuNjc3NiA2Mi43Njc0IDkwLjM4ODcgNjMuMDg1NloiIGZpbGw9IiNFNkVGRkMiLz48L2c+PC9nPjwvZz48ZyBpZD0iTGlnaHRuaW5nIj48cGF0aCBpZD0iTGlnaHRuaW5nIEJvbHQiIGQ9Ik02MC4wMDAzIDY4TDUyIDkwLjkwOTJINjAuMDAwM0w1NS45OTk1IDExMEw3NiA4My4yNzI4SDYzLjk5OTZMNzEuOTk5OSA2OEg2MC4wMDAzWiIgZmlsbD0iI0Y2QTgyMyIvPjwvZz48L2c+PGRlZnM+PGNsaXBQYXRoIGlkPSJjbGlwMF8yMDQ1XzM5ODUxIj48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4='], // thunderstorms.svg
  ['lightning-rainy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0idGh1bmRlcnN0b3Jtcy1yYWluIiBjbGlwLXBhdGg9InVybCgjY2xpcDBfMjA0NV8zOTg4NCkiPjxnIGlkPSJTa3kiPjxnIGlkPSJDbG91ZHMiPjxnIGlkPSJDbG91ZCI+PHBhdGggaWQ9IkNsb3VkXzIiIGQ9Ik05MC4zODg3IDYzLjA4NTZDOTIuNjg0IDUzLjg4MTkgODcuNzQxIDQ0LjEzNTcgNzkuMDA4NyA0MC40ODIyQzcwLjI2NTQgMzYuODI0MiA1OS44Mjc4IDQwLjEzNzUgNTQuODM3MyA0OC4yMTE1QzUwLjUzNjQgNDUuNjI1IDQ0Ljk3NTMgNDUuNzc4MSA0MC44MjQgNDguNTk5MUMzNi42ODMzIDUxLjQxMjggMzQuNDk5OCA1Ni41MTQzIDM1LjM1IDYxLjQ1MzlDMjguMzkyNyA2Mi43Njg1IDIzLjM5MzUgNjkuMzM5MyAyNC4wNjE2IDc2LjQwNzZDMjQuNzI5OCA4My40Nzc2IDMwLjg3MiA4OS4wMDE4IDM3Ljk1MzUgODlDNTUuNjA2NyA4OSA3My4zMDYxIDg5IDkwLjk3NjggODlDOTguMDQ0NyA4OSAxMDQgODMuMTE4OSAxMDQgNzYuMDI4MUMxMDQgNjguNzAxNSA5Ny42Nzc2IDYyLjc2NzQgOTAuMzg4NyA2My4wODU2WiIgZmlsbD0iI0U2RUZGQyIvPjwvZz48L2c+PC9nPjxnIGlkPSJQcmVjaXBpdGF0aW9uIj48ZyBpZD0iUmFpbmRyb3BzIj48cGF0aCBpZD0iUmFpbmRyb3AgMSIgZD0iTTUyIDgzVjk1IiBzdHJva2U9IiMwQTVBRDQiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLCA4KSIvPjxwYXRoIGlkPSJSYWluZHJvcCAyIiBkPSJNNjQgODNWOTUiIHN0cm9rZT0iIzBBNUFENCIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAsIDApIi8+PHBhdGggaWQ9IlJhaW5kcm9wIDMiIGQ9Ik03NiA4M1Y5NSIgc3Ryb2tlPSIjMEE1QUQ0IiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgOCkiLz48L2c+PC9nPjxnIGlkPSJMaWdodG5pbmciPjxwYXRoIGlkPSJMaWdodG5pbmcgQm9sdCIgZD0iTTYwLjAwMDMgNjhMNTIgOTAuOTA5Mkg2MC4wMDAzTDU1Ljk5OTUgMTEwTDc2IDgzLjI3MjhINjMuOTk5Nkw3MS45OTk5IDY4SDYwLjAwMDNaIiBmaWxsPSIjRjZBODIzIi8+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfMzk4ODQiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg=='], // thunderstorms-rain.svg
  ['snowy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0ib3ZlcmNhc3Qtc25vdyIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzIwNDVfMzk2OTUpIj48ZyBpZD0iU2t5Ij48ZyBpZD0iQ2xvdWRzIiBjbGlwLXBhdGg9InVybCgjY2xpcDFfMjA0NV8zOTY5NSkiPjxnIGlkPSJNYXNrIGdyb3VwIj48bWFzayBpZD0ibWFzazBfMjA0NV8zOTY5NSIgc3R5bGU9Im1hc2stdHlwZTphbHBoYSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMCIgeT0iMCIgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiPjxnIGlkPSJDbG91ZCBNYXNrIj48cGF0aCBpZD0iU3VidHJhY3QiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTI4IDBIMFYxMjhIMTI4VjBaTTM3Ljk1MTkgOTNIOTAuOTc1MkMxMDAuMjI3IDkzIDEwNy45OTggODUuMzUzIDEwNy45OTggNzYuMDI4MUMxMDcuOTk4IDY4LjAyMTcgMTAyLjMwNSA2MS4zNTAxIDk0LjkyNDggNTkuNTUxMkM5NS4zNjE5IDQ5LjkwMDUgODkuNjc0NCA0MC42MDkzIDgwLjU1MDkgMzYuNzkyMkM3MS4xMDcxIDMyLjg0MTEgNjAuMDY2NCAzNS42MTE5IDUzLjUzMDUgNDMuMjM4NEM0OC41NzAyIDQxLjU5NTYgNDIuOTgxNSA0Mi4yOTU3IDM4LjU3NDEgNDUuMjkwN0MzNC4xNDU5IDQ4LjI5OTggMzEuNDMwNSA1My4yODA5IDMxLjE4NDYgNTguNTM3OUMyNC4wNjMzIDYxLjQ2MyAxOS4zMjc4IDY4Ljg1MDYgMjAuMDc3NiA3Ni43ODM5QzIwLjk0MiA4NS45Mjk1IDI4LjgyODUgOTMuMDAxOCAzNy45NTE5IDkzWiIgZmlsbD0iYmxhY2siLz48L2c+PC9tYXNrPjxnIG1hc2s9InVybCgjbWFzazBfMjA0NV8zOTY5NSkiPjxnIGlkPSJTZWNvbmRhcnkgQ2xvdWQiPjxwYXRoIGlkPSJDbG91ZCIgZD0iTTEwMS4xOTQgNTUuNTYyMUMxMDIuMzY3IDUxLjA1IDk5Ljc2MDIgNDYuNDIyNSA5NS41MDQzIDQ0LjcxMzNDOTEuMTkxOSA0Mi45ODEzIDg1Ljk2MTIgNDQuNDc0MyA4My40MTg2IDQ4LjQyM0M4MS4yNjQ4IDQ3LjE3OTcgNzguNDk2IDQ3LjI0OTYgNzYuNDExOSA0OC42MDlDNzQuMzgwOCA0OS45MzQgNzMuMjQzNCA1Mi4zNzIgNzMuNjc1IDU0Ljc3ODlDNzAuMjk5OCA1NS4zOTExIDY3LjY4NzQgNTguNDY4OCA2OC4wMzA3IDYxLjk1NjFDNjguMzc0OCA2NS40NTExIDcxLjUzOTQgNjguMDAwOCA3NC45NzY3IDY4QzgzLjgxMjYgNjggOTIuNjUxNCA2Ny45OTI1IDEwMS40ODggNjhDMTA0LjkxMSA2OCAxMDggNjUuMjg0OSAxMDggNjEuNzc0QzEwOCA1OC4xNDI4IDEwNC43MjEgNTUuNDE0MiAxMDEuMTk0IDU1LjU2MjFaIiBmaWxsPSIjQjBCQ0NEIi8+PC9nPjwvZz48L2c+PGcgaWQ9IkNsb3VkXzIiPjxwYXRoIGlkPSJDbG91ZF8zIiBkPSJNOTAuMzg4NiA2My4wODU2QzkyLjY4MzggNTMuODgxOSA4Ny43NDA4IDQ0LjEzNTcgNzkuMDA4NSA0MC40ODIyQzcwLjI2NTMgMzYuODI0MiA1OS44Mjc3IDQwLjEzNzUgNTQuODM3MiA0OC4yMTE1QzUwLjUzNjMgNDUuNjI1IDQ0Ljk3NTIgNDUuNzc4MSA0MC44MjM5IDQ4LjU5OTFDMzYuNjgzMiA1MS40MTI4IDM0LjQ5OTYgNTYuNTE0MyAzNS4zNDk5IDYxLjQ1MzlDMjguMzkyNiA2Mi43Njg1IDIzLjM5MzQgNjkuMzM5MyAyNC4wNjE0IDc2LjQwNzZDMjQuNzI5NyA4My40Nzc2IDMwLjg3MTggODkuMDAxOCAzNy45NTM0IDg5QzU1LjYwNjYgODkgNzMuMzA2IDg5IDkwLjk3NjcgODlDOTguMDQ0NiA4OSAxMDQgODMuMTE4OSAxMDQgNzYuMDI4MUMxMDQgNjguNzAxNSA5Ny42Nzc1IDYyLjc2NzQgOTAuMzg4NiA2My4wODU2WiIgZmlsbD0iI0U2RUZGQyIvPjwvZz48L2c+PC9nPjxnIGlkPSJQcmVjaXBpdGF0aW9uIj48ZyBpZD0iU25vd2ZsYWtlcyI+PHBhdGggaWQ9IlNub3dmbGFrZSAxIiBkPSJNNTIuNTc4MSA5MC4zNjZMNTEuMzczNSA4OS42Nzc1QzUxLjQ3OTQgODkuMjMyNiA1MS40Nzg2IDg4Ljc2ODcgNTEuMzcwOCA4OC4zMjQxTDUyLjU3ODEgODcuNjM0NUM1Mi42NzM4IDg3LjU4MDUgNTIuNzU3NyA4Ny41MDc5IDUyLjgyNTIgODcuNDIxQzUyLjg5MjYgODcuMzM0MiA1Mi45NDIzIDg3LjIzNDcgNTIuOTcxMSA4Ny4xMjg0QzUyLjk5OTggODcuMDIyMSA1My4wMDcxIDg2LjkxMTIgNTIuOTkyNiA4Ni44MDJDNTIuOTc4MiA4Ni42OTI4IDUyLjk0MjIgODYuNTg3NiA1Mi44ODY4IDg2LjQ5MjZDNTIuNzczMiA4Ni4yOTk4IDUyLjU4ODYgODYuMTU5NyA1Mi4zNzI4IDg2LjEwMjVDNTIuMTU3IDg2LjA0NTIgNTEuOTI3NiA4Ni4wNzU0IDUxLjczMzkgODYuMTg2Nkw1MC41Mjc4IDg2Ljg3NjNDNTAuMTkzMSA4Ni41NTg2IDQ5Ljc4NjggODYuMzI2NCA0OS4zNDM3IDg2LjE5OTVWODQuODIwMkM0OS4zMzY4IDg0LjYwMDMgNDkuMjQ1IDg0LjM5MTggNDkuMDg3NSA4NC4yMzg3QzQ4LjkzIDg0LjA4NTYgNDguNzE5MiA4NCA0OC40OTk4IDg0QzQ4LjI4MDUgODQgNDguMDY5OSA4NC4wODU2IDQ3LjkxMjQgODQuMjM4N0M0Ny43NTQ4IDg0LjM5MTggNDcuNjYyOCA4NC42MDAzIDQ3LjY1NiA4NC44MjAyVjg2LjE5OTVDNDcuMjE0IDg2LjMyODkgNDYuODA4MSA4Ni41NTk4IDQ2LjQ3MDYgODYuODc0TDQ1LjI2NjIgODYuMTg1M0M0NS4wNzI0IDg2LjA3NDIgNDQuODQyOCA4Ni4wNDQgNDQuNjI3IDg2LjEwMTNDNDQuNDExMyA4Ni4xNTg1IDQ0LjIyNjcgODYuMjk4NiA0NC4xMTMgODYuNDkxM0M0NC4wNTc2IDg2LjU4NjQgNDQuMDIxNyA4Ni42OTE2IDQ0LjAwNzIgODYuODAwN0M0My45OTI4IDg2LjkwOTkgNDQgODcuMDIwOSA0NC4wMjg4IDg3LjEyNzFDNDQuMDU3NSA4Ny4yMzM0IDQ0LjEwNzIgODcuMzMyOSA0NC4xNzQ3IDg3LjQxOThDNDQuMjQyMSA4Ny41MDY3IDQ0LjMyNiA4Ny41NzkyIDQ0LjQyMTcgODcuNjMzMkw0NS42MjY0IDg4LjMyMTZDNDUuNTIwNCA4OC43NjY2IDQ1LjUyMTMgODkuMjMwNSA0NS42MjkgODkuNjc1TDQ0LjQyMTcgOTAuMzY0N0M0NC4zMjYgOTAuNDE4NyA0NC4yNDIxIDkwLjQ5MTIgNDQuMTc0NyA5MC41NzgxQzQ0LjEwNzIgOTAuNjY1IDQ0LjA1NzUgOTAuNzY0NSA0NC4wMjg4IDkwLjg3MDhDNDQgOTAuOTc3MSA0My45OTI4IDkxLjA4OCA0NC4wMDcyIDkxLjE5NzJDNDQuMDIxNyA5MS4zMDYzIDQ0LjA1NzYgOTEuNDExNSA0NC4xMTMgOTEuNTA2NkM0NC4yMjY3IDkxLjY5OTIgNDQuNDExMyA5MS44MzkyIDQ0LjYyNyA5MS44OTY1QzQ0Ljg0MjggOTEuOTUzNyA0NS4wNzI0IDkxLjkyMzYgNDUuMjY2MiA5MS44MTI2TDQ2LjQ3MjEgOTEuMTIyOUM0Ni44MDYzIDkxLjQ0MDkgNDcuMjEyOCA5MS42NzI2IDQ3LjY1NjIgOTEuNzk3OVY5My4xNzk4QzQ3LjY2MzEgOTMuMzk5NyA0Ny43NTUgOTMuNjA4MiA0Ny45MTI2IDkzLjc2MTNDNDguMDcwMSA5My45MTQ0IDQ4LjI4MDcgOTQgNDguNSA5NEM0OC43MTk0IDk0IDQ4LjkzMDIgOTMuOTE0NCA0OS4wODc3IDkzLjc2MTNDNDkuMjQ1MiA5My42MDgyIDQ5LjMzNyA5My4zOTk3IDQ5LjM0MzkgOTMuMTc5OFY5MS43OTc1QzQ5Ljc4NTMgOTEuNjY4MyA1MC4xOTA3IDkxLjQzNzggNTAuNTI3OCA5MS4xMjQyTDUxLjczNDEgOTEuODEzOEM1MS45Mjc4IDkxLjkyNDggNTIuMTU3MyA5MS45NTUgNTIuMzczIDkxLjg5NzdDNTIuNTg4OCA5MS44NDA1IDUyLjc3MzMgOTEuNzAwNSA1Mi44ODcgOTEuNTA3OUM1Mi45NDI0IDkxLjQxMjggNTIuOTc4NCA5MS4zMDc2IDUyLjk5MjggOTEuMTk4NEM1My4wMDczIDkxLjA4OTIgNTIuOTk5OCA5MC45NzgzIDUyLjk3MTEgOTAuODcyQzUyLjk0MjMgOTAuNzY1NyA1Mi44OTI5IDkwLjY2NjIgNTIuODI1NCA5MC41NzkzQzUyLjc1NzkgOTAuNDkyNSA1Mi42NzM4IDkwLjQxOTkgNTIuNTc4MSA5MC4zNjZaTTQ3Ljg2NjQgOTAuMDg2MUM0Ny43MjI5IDkwLjAwNSA0Ny41OTY4IDg5Ljg5NjEgNDcuNDk1NiA4OS43NjU3QzQ3LjM5NDQgODkuNjM1MyA0Ny4zMjAyIDg5LjQ4NiA0Ny4yNzcxIDg5LjMyNjZDNDcuMjMzOSA4OS4xNjcxIDQ3LjIyMjggODkuMDAwNyA0Ny4yNDQzIDg4LjgzNjlDNDcuMjY1OCA4OC42NzMxIDQ3LjMxOTcgODguNTE1MiA0Ny40MDI2IDg4LjM3MjRDNDcuNTczNSA4OC4wODQgNDcuODUwMyA4Ny44NzQzIDQ4LjE3MzYgODcuNzg4M0M0OC40OTcgODcuNzAyMyA0OC44NDExIDg3Ljc0NyA0OS4xMzIxIDg3LjkxMjZDNDkuMjc1NiA4Ny45OTM4IDQ5LjQwMTYgODguMTAyNyA0OS41MDI4IDg4LjIzMzFDNDkuNjA0IDg4LjM2MzUgNDkuNjc4MiA4OC41MTI3IDQ5LjcyMTQgODguNjcyMkM0OS43NjQ1IDg4LjgzMTYgNDkuNzc1NyA4OC45OTgxIDQ5Ljc1NDEgODkuMTYxOUM0OS43MzI2IDg5LjMyNTcgNDkuNjc4NyA4OS40ODM2IDQ5LjU5NTggODkuNjI2M0M0OS40MjUgODkuOTE0OSA0OS4xNDgyIDkwLjEyNDcgNDguODI0OCA5MC4yMTA4QzQ4LjUwMTQgOTAuMjk2OSA0OC4xNTc0IDkwLjI1MjMgNDcuODY2NCA5MC4wODY3VjkwLjA4NjFaIiBmaWxsPSIjODZDM0RCIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLCA4KSIvPjxwYXRoIGlkPSJTbm93Zmxha2UgMiIgZD0iTTY3LjU3ODEgOTAuMzY2TDY2LjM3MzUgODkuNjc3NUM2Ni40Nzk0IDg5LjIzMjYgNjYuNDc4NiA4OC43Njg3IDY2LjM3MDggODguMzI0MUw2Ny41NzgxIDg3LjYzNDVDNjcuNjczOCA4Ny41ODA1IDY3Ljc1NzcgODcuNTA3OSA2Ny44MjUyIDg3LjQyMUM2Ny44OTI2IDg3LjMzNDIgNjcuOTQyMyA4Ny4yMzQ3IDY3Ljk3MTEgODcuMTI4NEM2Ny45OTk4IDg3LjAyMjEgNjguMDA3MSA4Ni45MTEyIDY3Ljk5MjYgODYuODAyQzY3Ljk3ODIgODYuNjkyOCA2Ny45NDIyIDg2LjU4NzYgNjcuODg2OCA4Ni40OTI2QzY3Ljc3MzIgODYuMjk5OCA2Ny41ODg2IDg2LjE1OTcgNjcuMzcyOCA4Ni4xMDI1QzY3LjE1NyA4Ni4wNDUyIDY2LjkyNzYgODYuMDc1NCA2Ni43MzM5IDg2LjE4NjZMNjUuNTI3OCA4Ni44NzYzQzY1LjE5MzEgODYuNTU4NiA2NC43ODY4IDg2LjMyNjQgNjQuMzQzNyA4Ni4xOTk1Vjg0LjgyMDJDNjQuMzM2OCA4NC42MDAzIDY0LjI0NSA4NC4zOTE4IDY0LjA4NzUgODQuMjM4N0M2My45MyA4NC4wODU2IDYzLjcxOTIgODQgNjMuNDk5OCA4NEM2My4yODA1IDg0IDYzLjA2OTkgODQuMDg1NiA2Mi45MTI0IDg0LjIzODdDNjIuNzU0OCA4NC4zOTE4IDYyLjY2MjggODQuNjAwMyA2Mi42NTYgODQuODIwMlY4Ni4xOTk1QzYyLjIxNCA4Ni4zMjg5IDYxLjgwODEgODYuNTU5OCA2MS40NzA2IDg2Ljg3NEw2MC4yNjYyIDg2LjE4NTNDNjAuMDcyNCA4Ni4wNzQyIDU5Ljg0MjggODYuMDQ0IDU5LjYyNyA4Ni4xMDEzQzU5LjQxMTMgODYuMTU4NSA1OS4yMjY3IDg2LjI5ODYgNTkuMTEzIDg2LjQ5MTNDNTkuMDU3NiA4Ni41ODY0IDU5LjAyMTcgODYuNjkxNiA1OS4wMDcyIDg2LjgwMDdDNTguOTkyOCA4Ni45MDk5IDU5IDg3LjAyMDkgNTkuMDI4OCA4Ny4xMjcxQzU5LjA1NzUgODcuMjMzNCA1OS4xMDcyIDg3LjMzMjkgNTkuMTc0NyA4Ny40MTk4QzU5LjI0MjEgODcuNTA2NyA1OS4zMjYgODcuNTc5MiA1OS40MjE3IDg3LjYzMzJMNjAuNjI2NCA4OC4zMjE2QzYwLjUyMDQgODguNzY2NiA2MC41MjEzIDg5LjIzMDUgNjAuNjI5IDg5LjY3NUw1OS40MjE3IDkwLjM2NDdDNTkuMzI2IDkwLjQxODcgNTkuMjQyMSA5MC40OTEyIDU5LjE3NDcgOTAuNTc4MUM1OS4xMDcyIDkwLjY2NSA1OS4wNTc1IDkwLjc2NDUgNTkuMDI4OCA5MC44NzA4QzU5IDkwLjk3NzEgNTguOTkyOCA5MS4wODggNTkuMDA3MiA5MS4xOTcyQzU5LjAyMTcgOTEuMzA2MyA1OS4wNTc2IDkxLjQxMTUgNTkuMTEzIDkxLjUwNjZDNTkuMjI2NyA5MS42OTkyIDU5LjQxMTMgOTEuODM5MiA1OS42MjcgOTEuODk2NUM1OS44NDI4IDkxLjk1MzcgNjAuMDcyNCA5MS45MjM2IDYwLjI2NjIgOTEuODEyNkw2MS40NzIxIDkxLjEyMjlDNjEuODA2MyA5MS40NDA5IDYyLjIxMjggOTEuNjcyNiA2Mi42NTYyIDkxLjc5NzlWOTMuMTc5OEM2Mi42NjMxIDkzLjM5OTcgNjIuNzU1IDkzLjYwODIgNjIuOTEyNiA5My43NjEzQzYzLjA3MDEgOTMuOTE0NCA2My4yODA3IDk0IDYzLjUgOTRDNjMuNzE5NCA5NCA2My45MzAyIDkzLjkxNDQgNjQuMDg3NyA5My43NjEzQzY0LjI0NTIgOTMuNjA4MiA2NC4zMzcgOTMuMzk5NyA2NC4zNDM5IDkzLjE3OThWOTEuNzk3NUM2NC43ODUzIDkxLjY2ODMgNjUuMTkwNyA5MS40Mzc4IDY1LjUyNzggOTEuMTI0Mkw2Ni43MzQxIDkxLjgxMzhDNjYuOTI3OCA5MS45MjQ4IDY3LjE1NzMgOTEuOTU1IDY3LjM3MyA5MS44OTc3QzY3LjU4ODggOTEuODQwNSA2Ny43NzMzIDkxLjcwMDUgNjcuODg3IDkxLjUwNzlDNjcuOTQyNCA5MS40MTI4IDY3Ljk3ODQgOTEuMzA3NiA2Ny45OTI4IDkxLjE5ODRDNjguMDA3MyA5MS4wODkyIDY3Ljk5OTggOTAuOTc4MyA2Ny45NzExIDkwLjg3MkM2Ny45NDIzIDkwLjc2NTcgNjcuODkyOSA5MC42NjYyIDY3LjgyNTQgOTAuNTc5M0M2Ny43NTc5IDkwLjQ5MjUgNjcuNjczOCA5MC40MTk5IDY3LjU3ODEgOTAuMzY2Wk02Mi44NjY0IDkwLjA4NjFDNjIuNzIyOSA5MC4wMDUgNjIuNTk2OCA4OS44OTYxIDYyLjQ5NTYgODkuNzY1N0M2Mi4zOTQ0IDg5LjYzNTMgNjIuMzIwMiA4OS40ODYgNjIuMjc3MSA4OS4zMjY2QzYyLjIzMzkgODkuMTY3MSA2Mi4yMjI4IDg5LjAwMDcgNjIuMjQ0MyA4OC44MzY5QzYyLjI2NTggODguNjczMSA2Mi4zMTk3IDg4LjUxNTIgNjIuNDAyNiA4OC4zNzI0QzYyLjU3MzUgODguMDg0IDYyLjg1MDMgODcuODc0MyA2My4xNzM2IDg3Ljc4ODNDNjMuNDk3IDg3LjcwMjMgNjMuODQxMSA4Ny43NDcgNjQuMTMyMSA4Ny45MTI2QzY0LjI3NTYgODcuOTkzOCA2NC40MDE2IDg4LjEwMjcgNjQuNTAyOCA4OC4yMzMxQzY0LjYwNCA4OC4zNjM1IDY0LjY3ODIgODguNTEyNyA2NC43MjE0IDg4LjY3MjJDNjQuNzY0NSA4OC44MzE2IDY0Ljc3NTcgODguOTk4MSA2NC43NTQxIDg5LjE2MTlDNjQuNzMyNiA4OS4zMjU3IDY0LjY3ODcgODkuNDgzNiA2NC41OTU4IDg5LjYyNjNDNjQuNDI1IDg5LjkxNDkgNjQuMTQ4MiA5MC4xMjQ3IDYzLjgyNDggOTAuMjEwOEM2My41MDE0IDkwLjI5NjkgNjMuMTU3NCA5MC4yNTIzIDYyLjg2NjQgOTAuMDg2N1Y5MC4wODYxWiIgZmlsbD0iIzg2QzNEQiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgMCkiLz48cGF0aCBpZD0iU25vd2ZsYWtlIDMiIGQ9Ik04Mi41NzgxIDkwLjM2Nkw4MS4zNzM1IDg5LjY3NzVDODEuNDc5NCA4OS4yMzI2IDgxLjQ3ODYgODguNzY4NyA4MS4zNzA4IDg4LjMyNDFMODIuNTc4MSA4Ny42MzQ1QzgyLjY3MzggODcuNTgwNSA4Mi43NTc3IDg3LjUwNzkgODIuODI1MiA4Ny40MjFDODIuODkyNiA4Ny4zMzQyIDgyLjk0MjMgODcuMjM0NyA4Mi45NzExIDg3LjEyODRDODIuOTk5OCA4Ny4wMjIxIDgzLjAwNzEgODYuOTExMiA4Mi45OTI2IDg2LjgwMkM4Mi45NzgyIDg2LjY5MjggODIuOTQyMiA4Ni41ODc2IDgyLjg4NjggODYuNDkyNkM4Mi43NzMyIDg2LjI5OTggODIuNTg4NiA4Ni4xNTk3IDgyLjM3MjggODYuMTAyNUM4Mi4xNTcgODYuMDQ1MiA4MS45Mjc2IDg2LjA3NTQgODEuNzMzOSA4Ni4xODY2TDgwLjUyNzggODYuODc2M0M4MC4xOTMxIDg2LjU1ODYgNzkuNzg2OCA4Ni4zMjY0IDc5LjM0MzcgODYuMTk5NVY4NC44MjAyQzc5LjMzNjggODQuNjAwMyA3OS4yNDUgODQuMzkxOCA3OS4wODc1IDg0LjIzODdDNzguOTMgODQuMDg1NiA3OC43MTkyIDg0IDc4LjQ5OTggODRDNzguMjgwNSA4NCA3OC4wNjk5IDg0LjA4NTYgNzcuOTEyNCA4NC4yMzg3Qzc3Ljc1NDggODQuMzkxOCA3Ny42NjI4IDg0LjYwMDMgNzcuNjU2IDg0LjgyMDJWODYuMTk5NUM3Ny4yMTQgODYuMzI4OSA3Ni44MDgxIDg2LjU1OTggNzYuNDcwNiA4Ni44NzRMNzUuMjY2MiA4Ni4xODUzQzc1LjA3MjQgODYuMDc0MiA3NC44NDI4IDg2LjA0NCA3NC42MjcgODYuMTAxM0M3NC40MTEzIDg2LjE1ODUgNzQuMjI2NyA4Ni4yOTg2IDc0LjExMyA4Ni40OTEzQzc0LjA1NzYgODYuNTg2NCA3NC4wMjE3IDg2LjY5MTYgNzQuMDA3MiA4Ni44MDA3QzczLjk5MjggODYuOTA5OSA3NCA4Ny4wMjA5IDc0LjAyODggODcuMTI3MUM3NC4wNTc1IDg3LjIzMzQgNzQuMTA3MiA4Ny4zMzI5IDc0LjE3NDcgODcuNDE5OEM3NC4yNDIxIDg3LjUwNjcgNzQuMzI2IDg3LjU3OTIgNzQuNDIxNyA4Ny42MzMyTDc1LjYyNjQgODguMzIxNkM3NS41MjA0IDg4Ljc2NjYgNzUuNTIxMyA4OS4yMzA1IDc1LjYyOSA4OS42NzVMNzQuNDIxNyA5MC4zNjQ3Qzc0LjMyNiA5MC40MTg3IDc0LjI0MjEgOTAuNDkxMiA3NC4xNzQ3IDkwLjU3ODFDNzQuMTA3MiA5MC42NjUgNzQuMDU3NSA5MC43NjQ1IDc0LjAyODggOTAuODcwOEM3NCA5MC45NzcxIDczLjk5MjggOTEuMDg4IDc0LjAwNzIgOTEuMTk3MkM3NC4wMjE3IDkxLjMwNjMgNzQuMDU3NiA5MS40MTE1IDc0LjExMyA5MS41MDY2Qzc0LjIyNjcgOTEuNjk5MiA3NC40MTEzIDkxLjgzOTIgNzQuNjI3IDkxLjg5NjVDNzQuODQyOCA5MS45NTM3IDc1LjA3MjQgOTEuOTIzNiA3NS4yNjYyIDkxLjgxMjZMNzYuNDcyMSA5MS4xMjI5Qzc2LjgwNjMgOTEuNDQwOSA3Ny4yMTI4IDkxLjY3MjYgNzcuNjU2MiA5MS43OTc5VjkzLjE3OThDNzcuNjYzMSA5My4zOTk3IDc3Ljc1NSA5My42MDgyIDc3LjkxMjYgOTMuNzYxM0M3OC4wNzAxIDkzLjkxNDQgNzguMjgwNyA5NCA3OC41IDk0Qzc4LjcxOTQgOTQgNzguOTMwMiA5My45MTQ0IDc5LjA4NzcgOTMuNzYxM0M3OS4yNDUyIDkzLjYwODIgNzkuMzM3IDkzLjM5OTcgNzkuMzQzOSA5My4xNzk4VjkxLjc5NzVDNzkuNzg1MyA5MS42NjgzIDgwLjE5MDcgOTEuNDM3OCA4MC41Mjc4IDkxLjEyNDJMODEuNzM0MSA5MS44MTM4QzgxLjkyNzggOTEuOTI0OCA4Mi4xNTczIDkxLjk1NSA4Mi4zNzMgOTEuODk3N0M4Mi41ODg4IDkxLjg0MDUgODIuNzczMyA5MS43MDA1IDgyLjg4NyA5MS41MDc5QzgyLjk0MjQgOTEuNDEyOCA4Mi45Nzg0IDkxLjMwNzYgODIuOTkyOCA5MS4xOTg0QzgzLjAwNzMgOTEuMDg5MiA4Mi45OTk4IDkwLjk3ODMgODIuOTcxMSA5MC44NzJDODIuOTQyMyA5MC43NjU3IDgyLjg5MjkgOTAuNjY2MiA4Mi44MjU0IDkwLjU3OTNDODIuNzU3OSA5MC40OTI1IDgyLjY3MzggOTAuNDE5OSA4Mi41NzgxIDkwLjM2NlpNNzcuODY2NCA5MC4wODYxQzc3LjcyMjkgOTAuMDA1IDc3LjU5NjggODkuODk2MSA3Ny40OTU2IDg5Ljc2NTdDNzcuMzk0NCA4OS42MzUzIDc3LjMyMDIgODkuNDg2IDc3LjI3NzEgODkuMzI2NkM3Ny4yMzM5IDg5LjE2NzEgNzcuMjIyOCA4OS4wMDA3IDc3LjI0NDMgODguODM2OUM3Ny4yNjU4IDg4LjY3MzEgNzcuMzE5NyA4OC41MTUyIDc3LjQwMjYgODguMzcyNEM3Ny41NzM1IDg4LjA4NCA3Ny44NTAzIDg3Ljg3NDMgNzguMTczNiA4Ny43ODgzQzc4LjQ5NyA4Ny43MDIzIDc4Ljg0MTEgODcuNzQ3IDc5LjEzMjEgODcuOTEyNkM3OS4yNzU2IDg3Ljk5MzggNzkuNDAxNiA4OC4xMDI3IDc5LjUwMjggODguMjMzMUM3OS42MDQgODguMzYzNSA3OS42NzgyIDg4LjUxMjcgNzkuNzIxNCA4OC42NzIyQzc5Ljc2NDUgODguODMxNiA3OS43NzU3IDg4Ljk5ODEgNzkuNzU0MSA4OS4xNjE5Qzc5LjczMjYgODkuMzI1NyA3OS42Nzg3IDg5LjQ4MzYgNzkuNTk1OCA4OS42MjYzQzc5LjQyNSA4OS45MTQ5IDc5LjE0ODIgOTAuMTI0NyA3OC44MjQ4IDkwLjIxMDhDNzguNTAxNCA5MC4yOTY5IDc4LjE1NzQgOTAuMjUyMyA3Ny44NjY0IDkwLjA4NjdWOTAuMDg2MVoiIGZpbGw9IiM4NkMzREIiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAsIDgpIi8+PC9nPjwvZz48L2c+PGRlZnM+PGNsaXBQYXRoIGlkPSJjbGlwMF8yMDQ1XzM5Njk1Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjxjbGlwUGF0aCBpZD0iY2xpcDFfMjA0NV8zOTY5NSI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IndoaXRlIi8+PC9jbGlwUGF0aD48L2RlZnM+PC9zdmc+'], // overcast-snow.svg
  ['snowy-rainy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0ib3ZlcmNhc3Qtc2xlZXQiIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8yMDQ1XzM5NzI4KSI+PGcgaWQ9IlNreSI+PGcgaWQ9IkNsb3VkcyIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAxXzIwNDVfMzk3MjgpIj48ZyBpZD0iTWFzayBncm91cCI+PG1hc2sgaWQ9Im1hc2swXzIwNDVfMzk3MjgiIHN0eWxlPSJtYXNrLXR5cGU6YWxwaGEiIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9IjAiIHk9IjAiIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48ZyBpZD0iQ2xvdWQgTWFzayI+PHBhdGggaWQ9IlN1YnRyYWN0IiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEyOCAwSDBWMTI4SDEyOFYwWk0zNy45NTE5IDkzSDkwLjk3NTJDMTAwLjIyNyA5MyAxMDcuOTk4IDg1LjM1MyAxMDcuOTk4IDc2LjAyODFDMTA3Ljk5OCA2OC4wMjE3IDEwMi4zMDUgNjEuMzUwMSA5NC45MjQ4IDU5LjU1MTJDOTUuMzYxOSA0OS45MDA1IDg5LjY3NDQgNDAuNjA5MyA4MC41NTA5IDM2Ljc5MjJDNzEuMTA3MSAzMi44NDExIDYwLjA2NjQgMzUuNjExOSA1My41MzA1IDQzLjIzODRDNDguNTcwMiA0MS41OTU2IDQyLjk4MTUgNDIuMjk1NyAzOC41NzQxIDQ1LjI5MDdDMzQuMTQ1OSA0OC4yOTk4IDMxLjQzMDUgNTMuMjgwOSAzMS4xODQ2IDU4LjUzNzlDMjQuMDYzMyA2MS40NjMgMTkuMzI3OCA2OC44NTA2IDIwLjA3NzYgNzYuNzgzOUMyMC45NDIgODUuOTI5NSAyOC44Mjg1IDkzLjAwMTggMzcuOTUxOSA5M1oiIGZpbGw9ImJsYWNrIi8+PC9nPjwvbWFzaz48ZyBtYXNrPSJ1cmwoI21hc2swXzIwNDVfMzk3MjgpIj48ZyBpZD0iU2Vjb25kYXJ5IENsb3VkIj48cGF0aCBpZD0iQ2xvdWQiIGQ9Ik0xMDEuMTk0IDU1LjU2MjFDMTAyLjM2NyA1MS4wNSA5OS43NjAyIDQ2LjQyMjUgOTUuNTA0MyA0NC43MTMzQzkxLjE5MTkgNDIuOTgxMyA4NS45NjEyIDQ0LjQ3NDMgODMuNDE4NiA0OC40MjNDODEuMjY0OCA0Ny4xNzk3IDc4LjQ5NiA0Ny4yNDk2IDc2LjQxMTkgNDguNjA5Qzc0LjM4MDggNDkuOTM0IDczLjI0MzQgNTIuMzcyIDczLjY3NSA1NC43Nzg5QzcwLjI5OTggNTUuMzkxMSA2Ny42ODc0IDU4LjQ2ODggNjguMDMwNyA2MS45NTYxQzY4LjM3NDggNjUuNDUxMSA3MS41Mzk0IDY4LjAwMDggNzQuOTc2NyA2OEM4My44MTI2IDY4IDkyLjY1MTQgNjcuOTkyNSAxMDEuNDg4IDY4QzEwNC45MTEgNjggMTA4IDY1LjI4NDkgMTA4IDYxLjc3NEMxMDggNTguMTQyOCAxMDQuNzIxIDU1LjQxNDIgMTAxLjE5NCA1NS41NjIxWiIgZmlsbD0iI0IwQkNDRCIvPjwvZz48L2c+PC9nPjxnIGlkPSJDbG91ZF8yIj48cGF0aCBpZD0iQ2xvdWRfMyIgZD0iTTkwLjM4ODYgNjMuMDg1NkM5Mi42ODM4IDUzLjg4MTkgODcuNzQwOCA0NC4xMzU3IDc5LjAwODUgNDAuNDgyMkM3MC4yNjUzIDM2LjgyNDIgNTkuODI3NyA0MC4xMzc1IDU0LjgzNzIgNDguMjExNUM1MC41MzYzIDQ1LjYyNSA0NC45NzUyIDQ1Ljc3ODEgNDAuODIzOSA0OC41OTkxQzM2LjY4MzIgNTEuNDEyOCAzNC40OTk2IDU2LjUxNDMgMzUuMzQ5OSA2MS40NTM5QzI4LjM5MjYgNjIuNzY4NSAyMy4zOTM0IDY5LjMzOTMgMjQuMDYxNCA3Ni40MDc2QzI0LjcyOTcgODMuNDc3NiAzMC44NzE4IDg5LjAwMTggMzcuOTUzNCA4OUM1NS42MDY2IDg5IDczLjMwNiA4OSA5MC45NzY3IDg5Qzk4LjA0NDYgODkgMTA0IDgzLjExODkgMTA0IDc2LjAyODFDMTA0IDY4LjcwMTUgOTcuNjc3NSA2Mi43Njc0IDkwLjM4ODYgNjMuMDg1NloiIGZpbGw9IiNFNkVGRkMiLz48L2c+PC9nPjwvZz48ZyBpZD0iUHJlY2lwaXRhdGlvbiI+PGcgaWQ9IlNub3dmbGFrZXMiPjxwYXRoIGlkPSJTbm93Zmxha2UgMSIgZD0iTTUyLjU3ODEgOTAuMzY2TDUxLjM3MzUgODkuNjc3NUM1MS40Nzk0IDg5LjIzMjYgNTEuNDc4NiA4OC43Njg3IDUxLjM3MDggODguMzI0MUw1Mi41NzgxIDg3LjYzNDVDNTIuNjczOCA4Ny41ODA1IDUyLjc1NzcgODcuNTA3OSA1Mi44MjUyIDg3LjQyMUM1Mi44OTI2IDg3LjMzNDIgNTIuOTQyMyA4Ny4yMzQ3IDUyLjk3MTEgODcuMTI4NEM1Mi45OTk4IDg3LjAyMjEgNTMuMDA3MSA4Ni45MTEyIDUyLjk5MjYgODYuODAyQzUyLjk3ODIgODYuNjkyOCA1Mi45NDIyIDg2LjU4NzYgNTIuODg2OCA4Ni40OTI2QzUyLjc3MzIgODYuMjk5OCA1Mi41ODg2IDg2LjE1OTcgNTIuMzcyOCA4Ni4xMDI1QzUyLjE1NyA4Ni4wNDUyIDUxLjkyNzYgODYuMDc1NCA1MS43MzM5IDg2LjE4NjZMNTAuNTI3OCA4Ni44NzYzQzUwLjE5MzEgODYuNTU4NiA0OS43ODY4IDg2LjMyNjQgNDkuMzQzNyA4Ni4xOTk1Vjg0LjgyMDJDNDkuMzM2OCA4NC42MDAzIDQ5LjI0NSA4NC4zOTE4IDQ5LjA4NzUgODQuMjM4N0M0OC45MyA4NC4wODU2IDQ4LjcxOTIgODQgNDguNDk5OCA4NEM0OC4yODA1IDg0IDQ4LjA2OTkgODQuMDg1NiA0Ny45MTI0IDg0LjIzODdDNDcuNzU0OCA4NC4zOTE4IDQ3LjY2MjggODQuNjAwMyA0Ny42NTYgODQuODIwMlY4Ni4xOTk1QzQ3LjIxNCA4Ni4zMjg5IDQ2LjgwODEgODYuNTU5OCA0Ni40NzA2IDg2Ljg3NEw0NS4yNjYyIDg2LjE4NTNDNDUuMDcyNCA4Ni4wNzQyIDQ0Ljg0MjggODYuMDQ0IDQ0LjYyNyA4Ni4xMDEzQzQ0LjQxMTMgODYuMTU4NSA0NC4yMjY3IDg2LjI5ODYgNDQuMTEzIDg2LjQ5MTNDNDQuMDU3NiA4Ni41ODY0IDQ0LjAyMTcgODYuNjkxNiA0NC4wMDcyIDg2LjgwMDdDNDMuOTkyOCA4Ni45MDk5IDQ0IDg3LjAyMDkgNDQuMDI4OCA4Ny4xMjcxQzQ0LjA1NzUgODcuMjMzNCA0NC4xMDcyIDg3LjMzMjkgNDQuMTc0NyA4Ny40MTk4QzQ0LjI0MjEgODcuNTA2NyA0NC4zMjYgODcuNTc5MiA0NC40MjE3IDg3LjYzMzJMNDUuNjI2NCA4OC4zMjE2QzQ1LjUyMDQgODguNzY2NiA0NS41MjEzIDg5LjIzMDUgNDUuNjI5IDg5LjY3NUw0NC40MjE3IDkwLjM2NDdDNDQuMzI2IDkwLjQxODcgNDQuMjQyMSA5MC40OTEyIDQ0LjE3NDcgOTAuNTc4MUM0NC4xMDcyIDkwLjY2NSA0NC4wNTc1IDkwLjc2NDUgNDQuMDI4OCA5MC44NzA4QzQ0IDkwLjk3NzEgNDMuOTkyOCA5MS4wODggNDQuMDA3MiA5MS4xOTcyQzQ0LjAyMTcgOTEuMzA2MyA0NC4wNTc2IDkxLjQxMTUgNDQuMTEzIDkxLjUwNjZDNDQuMjI2NyA5MS42OTkyIDQ0LjQxMTMgOTEuODM5MiA0NC42MjcgOTEuODk2NUM0NC44NDI4IDkxLjk1MzcgNDUuMDcyNCA5MS45MjM2IDQ1LjI2NjIgOTEuODEyNkw0Ni40NzIxIDkxLjEyMjlDNDYuODA2MyA5MS40NDA5IDQ3LjIxMjggOTEuNjcyNiA0Ny42NTYyIDkxLjc5NzlWOTMuMTc5OEM0Ny42NjMxIDkzLjM5OTcgNDcuNzU1IDkzLjYwODIgNDcuOTEyNiA5My43NjEzQzQ4LjA3MDEgOTMuOTE0NCA0OC4yODA3IDk0IDQ4LjUgOTRDNDguNzE5NCA5NCA0OC45MzAyIDkzLjkxNDQgNDkuMDg3NyA5My43NjEzQzQ5LjI0NTIgOTMuNjA4MiA0OS4zMzcgOTMuMzk5NyA0OS4zNDM5IDkzLjE3OThWOTEuNzk3NUM0OS43ODUzIDkxLjY2ODMgNTAuMTkwNyA5MS40Mzc4IDUwLjUyNzggOTEuMTI0Mkw1MS43MzQxIDkxLjgxMzhDNTEuOTI3OCA5MS45MjQ4IDUyLjE1NzMgOTEuOTU1IDUyLjM3MyA5MS44OTc3QzUyLjU4ODggOTEuODQwNSA1Mi43NzMzIDkxLjcwMDUgNTIuODg3IDkxLjUwNzlDNTIuOTQyNCA5MS40MTI4IDUyLjk3ODQgOTEuMzA3NiA1Mi45OTI4IDkxLjE5ODRDNTMuMDA3MyA5MS4wODkyIDUyLjk5OTggOTAuOTc4MyA1Mi45NzExIDkwLjg3MkM1Mi45NDIzIDkwLjc2NTcgNTIuODkyOSA5MC42NjYyIDUyLjgyNTQgOTAuNTc5M0M1Mi43NTc5IDkwLjQ5MjUgNTIuNjczOCA5MC40MTk5IDUyLjU3ODEgOTAuMzY2Wk00Ny44NjY0IDkwLjA4NjFDNDcuNzIyOSA5MC4wMDUgNDcuNTk2OCA4OS44OTYxIDQ3LjQ5NTYgODkuNzY1N0M0Ny4zOTQ0IDg5LjYzNTMgNDcuMzIwMiA4OS40ODYgNDcuMjc3MSA4OS4zMjY2QzQ3LjIzMzkgODkuMTY3MSA0Ny4yMjI4IDg5LjAwMDcgNDcuMjQ0MyA4OC44MzY5QzQ3LjI2NTggODguNjczMSA0Ny4zMTk3IDg4LjUxNTIgNDcuNDAyNiA4OC4zNzI0QzQ3LjU3MzUgODguMDg0IDQ3Ljg1MDMgODcuODc0MyA0OC4xNzM2IDg3Ljc4ODNDNDguNDk3IDg3LjcwMjMgNDguODQxMSA4Ny43NDcgNDkuMTMyMSA4Ny45MTI2QzQ5LjI3NTYgODcuOTkzOCA0OS40MDE2IDg4LjEwMjcgNDkuNTAyOCA4OC4yMzMxQzQ5LjYwNCA4OC4zNjM1IDQ5LjY3ODIgODguNTEyNyA0OS43MjE0IDg4LjY3MjJDNDkuNzY0NSA4OC44MzE2IDQ5Ljc3NTcgODguOTk4MSA0OS43NTQxIDg5LjE2MTlDNDkuNzMyNiA4OS4zMjU3IDQ5LjY3ODcgODkuNDgzNiA0OS41OTU4IDg5LjYyNjNDNDkuNDI1IDg5LjkxNDkgNDkuMTQ4MiA5MC4xMjQ3IDQ4LjgyNDggOTAuMjEwOEM0OC41MDE0IDkwLjI5NjkgNDguMTU3NCA5MC4yNTIzIDQ3Ljg2NjQgOTAuMDg2N1Y5MC4wODYxWiIgZmlsbD0iIzg2QzNEQiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgMCkiLz48cGF0aCBpZD0iU25vd2ZsYWtlIDIiIGQ9Ik02Ny41NzgxIDkwLjM2Nkw2Ni4zNzM1IDg5LjY3NzVDNjYuNDc5NCA4OS4yMzI2IDY2LjQ3ODYgODguNzY4NyA2Ni4zNzA4IDg4LjMyNDFMNjcuNTc4MSA4Ny42MzQ1QzY3LjY3MzggODcuNTgwNSA2Ny43NTc3IDg3LjUwNzkgNjcuODI1MiA4Ny40MjFDNjcuODkyNiA4Ny4zMzQyIDY3Ljk0MjMgODcuMjM0NyA2Ny45NzExIDg3LjEyODRDNjcuOTk5OCA4Ny4wMjIxIDY4LjAwNzEgODYuOTExMiA2Ny45OTI2IDg2LjgwMkM2Ny45NzgyIDg2LjY5MjggNjcuOTQyMiA4Ni41ODc2IDY3Ljg4NjggODYuNDkyNkM2Ny43NzMyIDg2LjI5OTggNjcuNTg4NiA4Ni4xNTk3IDY3LjM3MjggODYuMTAyNUM2Ny4xNTcgODYuMDQ1MiA2Ni45Mjc2IDg2LjA3NTQgNjYuNzMzOSA4Ni4xODY2TDY1LjUyNzggODYuODc2M0M2NS4xOTMxIDg2LjU1ODYgNjQuNzg2OCA4Ni4zMjY0IDY0LjM0MzcgODYuMTk5NVY4NC44MjAyQzY0LjMzNjggODQuNjAwMyA2NC4yNDUgODQuMzkxOCA2NC4wODc1IDg0LjIzODdDNjMuOTMgODQuMDg1NiA2My43MTkyIDg0IDYzLjQ5OTggODRDNjMuMjgwNSA4NCA2My4wNjk5IDg0LjA4NTYgNjIuOTEyNCA4NC4yMzg3QzYyLjc1NDggODQuMzkxOCA2Mi42NjI4IDg0LjYwMDMgNjIuNjU2IDg0LjgyMDJWODYuMTk5NUM2Mi4yMTQgODYuMzI4OSA2MS44MDgxIDg2LjU1OTggNjEuNDcwNiA4Ni44NzRMNjAuMjY2MiA4Ni4xODUzQzYwLjA3MjQgODYuMDc0MiA1OS44NDI4IDg2LjA0NCA1OS42MjcgODYuMTAxM0M1OS40MTEzIDg2LjE1ODUgNTkuMjI2NyA4Ni4yOTg2IDU5LjExMyA4Ni40OTEzQzU5LjA1NzYgODYuNTg2NCA1OS4wMjE3IDg2LjY5MTYgNTkuMDA3MiA4Ni44MDA3QzU4Ljk5MjggODYuOTA5OSA1OSA4Ny4wMjA5IDU5LjAyODggODcuMTI3MUM1OS4wNTc1IDg3LjIzMzQgNTkuMTA3MiA4Ny4zMzI5IDU5LjE3NDcgODcuNDE5OEM1OS4yNDIxIDg3LjUwNjcgNTkuMzI2IDg3LjU3OTIgNTkuNDIxNyA4Ny42MzMyTDYwLjYyNjQgODguMzIxNkM2MC41MjA0IDg4Ljc2NjYgNjAuNTIxMyA4OS4yMzA1IDYwLjYyOSA4OS42NzVMNTkuNDIxNyA5MC4zNjQ3QzU5LjMyNiA5MC40MTg3IDU5LjI0MjEgOTAuNDkxMiA1OS4xNzQ3IDkwLjU3ODFDNTkuMTA3MiA5MC42NjUgNTkuMDU3NSA5MC43NjQ1IDU5LjAyODggOTAuODcwOEM1OSA5MC45NzcxIDU4Ljk5MjggOTEuMDg4IDU5LjAwNzIgOTEuMTk3MkM1OS4wMjE3IDkxLjMwNjMgNTkuMDU3NiA5MS40MTE1IDU5LjExMyA5MS41MDY2QzU5LjIyNjcgOTEuNjk5MiA1OS40MTEzIDkxLjgzOTIgNTkuNjI3IDkxLjg5NjVDNTkuODQyOCA5MS45NTM3IDYwLjA3MjQgOTEuOTIzNiA2MC4yNjYyIDkxLjgxMjZMNjEuNDcyMSA5MS4xMjI5QzYxLjgwNjMgOTEuNDQwOSA2Mi4yMTI4IDkxLjY3MjYgNjIuNjU2MiA5MS43OTc5VjkzLjE3OThDNjIuNjYzMSA5My4zOTk3IDYyLjc1NSA5My42MDgyIDYyLjkxMjYgOTMuNzYxM0M2My4wNzAxIDkzLjkxNDQgNjMuMjgwNyA5NCA2My41IDk0QzYzLjcxOTQgOTQgNjMuOTMwMiA5My45MTQ0IDY0LjA4NzcgOTMuNzYxM0M2NC4yNDUyIDkzLjYwODIgNjQuMzM3IDkzLjM5OTcgNjQuMzQzOSA5My4xNzk4VjkxLjc5NzVDNjQuNzg1MyA5MS42NjgzIDY1LjE5MDcgOTEuNDM3OCA2NS41Mjc4IDkxLjEyNDJMNjYuNzM0MSA5MS44MTM4QzY2LjkyNzggOTEuOTI0OCA2Ny4xNTczIDkxLjk1NSA2Ny4zNzMgOTEuODk3N0M2Ny41ODg4IDkxLjg0MDUgNjcuNzczMyA5MS43MDA1IDY3Ljg4NyA5MS41MDc5QzY3Ljk0MjQgOTEuNDEyOCA2Ny45Nzg0IDkxLjMwNzYgNjcuOTkyOCA5MS4xOTg0QzY4LjAwNzMgOTEuMDg5MiA2Ny45OTk4IDkwLjk3ODMgNjcuOTcxMSA5MC44NzJDNjcuOTQyMyA5MC43NjU3IDY3Ljg5MjkgOTAuNjY2MiA2Ny44MjU0IDkwLjU3OTNDNjcuNzU3OSA5MC40OTI1IDY3LjY3MzggOTAuNDE5OSA2Ny41NzgxIDkwLjM2NlpNNjIuODY2NCA5MC4wODYxQzYyLjcyMjkgOTAuMDA1IDYyLjU5NjggODkuODk2MSA2Mi40OTU2IDg5Ljc2NTdDNjIuMzk0NCA4OS42MzUzIDYyLjMyMDIgODkuNDg2IDYyLjI3NzEgODkuMzI2NkM2Mi4yMzM5IDg5LjE2NzEgNjIuMjIyOCA4OS4wMDA3IDYyLjI0NDMgODguODM2OUM2Mi4yNjU4IDg4LjY3MzEgNjIuMzE5NyA4OC41MTUyIDYyLjQwMjYgODguMzcyNEM2Mi41NzM1IDg4LjA4NCA2Mi44NTAzIDg3Ljg3NDMgNjMuMTczNiA4Ny43ODgzQzYzLjQ5NyA4Ny43MDIzIDYzLjg0MTEgODcuNzQ3IDY0LjEzMjEgODcuOTEyNkM2NC4yNzU2IDg3Ljk5MzggNjQuNDAxNiA4OC4xMDI3IDY0LjUwMjggODguMjMzMUM2NC42MDQgODguMzYzNSA2NC42NzgyIDg4LjUxMjcgNjQuNzIxNCA4OC42NzIyQzY0Ljc2NDUgODguODMxNiA2NC43NzU3IDg4Ljk5ODEgNjQuNzU0MSA4OS4xNjE5QzY0LjczMjYgODkuMzI1NyA2NC42Nzg3IDg5LjQ4MzYgNjQuNTk1OCA4OS42MjYzQzY0LjQyNSA4OS45MTQ5IDY0LjE0ODIgOTAuMTI0NyA2My44MjQ4IDkwLjIxMDhDNjMuNTAxNCA5MC4yOTY5IDYzLjE1NzQgOTAuMjUyMyA2Mi44NjY0IDkwLjA4NjdWOTAuMDg2MVoiIGZpbGw9IiM4NkMzREIiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAsIDE2KSIvPjxwYXRoIGlkPSJTbm93Zmxha2UgMyIgZD0iTTgyLjU3ODEgOTAuMzY2TDgxLjM3MzUgODkuNjc3NUM4MS40Nzk0IDg5LjIzMjYgODEuNDc4NiA4OC43Njg3IDgxLjM3MDggODguMzI0MUw4Mi41NzgxIDg3LjYzNDVDODIuNjczOCA4Ny41ODA1IDgyLjc1NzcgODcuNTA3OSA4Mi44MjUyIDg3LjQyMUM4Mi44OTI2IDg3LjMzNDIgODIuOTQyMyA4Ny4yMzQ3IDgyLjk3MTEgODcuMTI4NEM4Mi45OTk4IDg3LjAyMjEgODMuMDA3MSA4Ni45MTEyIDgyLjk5MjYgODYuODAyQzgyLjk3ODIgODYuNjkyOCA4Mi45NDIyIDg2LjU4NzYgODIuODg2OCA4Ni40OTI2QzgyLjc3MzIgODYuMjk5OCA4Mi41ODg2IDg2LjE1OTcgODIuMzcyOCA4Ni4xMDI1QzgyLjE1NyA4Ni4wNDUyIDgxLjkyNzYgODYuMDc1NCA4MS43MzM5IDg2LjE4NjZMODAuNTI3OCA4Ni44NzYzQzgwLjE5MzEgODYuNTU4NiA3OS43ODY4IDg2LjMyNjQgNzkuMzQzNyA4Ni4xOTk1Vjg0LjgyMDJDNzkuMzM2OCA4NC42MDAzIDc5LjI0NSA4NC4zOTE4IDc5LjA4NzUgODQuMjM4N0M3OC45MyA4NC4wODU2IDc4LjcxOTIgODQgNzguNDk5OCA4NEM3OC4yODA1IDg0IDc4LjA2OTkgODQuMDg1NiA3Ny45MTI0IDg0LjIzODdDNzcuNzU0OCA4NC4zOTE4IDc3LjY2MjggODQuNjAwMyA3Ny42NTYgODQuODIwMlY4Ni4xOTk1Qzc3LjIxNCA4Ni4zMjg5IDc2LjgwODEgODYuNTU5OCA3Ni40NzA2IDg2Ljg3NEw3NS4yNjYyIDg2LjE4NTNDNzUuMDcyNCA4Ni4wNzQyIDc0Ljg0MjggODYuMDQ0IDc0LjYyNyA4Ni4xMDEzQzc0LjQxMTMgODYuMTU4NSA3NC4yMjY3IDg2LjI5ODYgNzQuMTEzIDg2LjQ5MTNDNzQuMDU3NiA4Ni41ODY0IDc0LjAyMTcgODYuNjkxNiA3NC4wMDcyIDg2LjgwMDdDNzMuOTkyOCA4Ni45MDk5IDc0IDg3LjAyMDkgNzQuMDI4OCA4Ny4xMjcxQzc0LjA1NzUgODcuMjMzNCA3NC4xMDcyIDg3LjMzMjkgNzQuMTc0NyA4Ny40MTk4Qzc0LjI0MjEgODcuNTA2NyA3NC4zMjYgODcuNTc5MiA3NC40MjE3IDg3LjYzMzJMNzUuNjI2NCA4OC4zMjE2Qzc1LjUyMDQgODguNzY2NiA3NS41MjEzIDg5LjIzMDUgNzUuNjI5IDg5LjY3NUw3NC40MjE3IDkwLjM2NDdDNzQuMzI2IDkwLjQxODcgNzQuMjQyMSA5MC40OTEyIDc0LjE3NDcgOTAuNTc4MUM3NC4xMDcyIDkwLjY2NSA3NC4wNTc1IDkwLjc2NDUgNzQuMDI4OCA5MC44NzA4Qzc0IDkwLjk3NzEgNzMuOTkyOCA5MS4wODggNzQuMDA3MiA5MS4xOTcyQzc0LjAyMTcgOTEuMzA2MyA3NC4wNTc2IDkxLjQxMTUgNzQuMTEzIDkxLjUwNjZDNzQuMjI2NyA5MS42OTkyIDc0LjQxMTMgOTEuODM5MiA3NC42MjcgOTEuODk2NUM3NC44NDI4IDkxLjk1MzcgNzUuMDcyNCA5MS45MjM2IDc1LjI2NjIgOTEuODEyNkw3Ni40NzIxIDkxLjEyMjlDNzYuODA2MyA5MS40NDA5IDc3LjIxMjggOTEuNjcyNiA3Ny42NTYyIDkxLjc5NzlWOTMuMTc5OEM3Ny42NjMxIDkzLjM5OTcgNzcuNzU1IDkzLjYwODIgNzcuOTEyNiA5My43NjEzQzc4LjA3MDEgOTMuOTE0NCA3OC4yODA3IDk0IDc4LjUgOTRDNzguNzE5NCA5NCA3OC45MzAyIDkzLjkxNDQgNzkuMDg3NyA5My43NjEzQzc5LjI0NTIgOTMuNjA4MiA3OS4zMzcgOTMuMzk5NyA3OS4zNDM5IDkzLjE3OThWOTEuNzk3NUM3OS43ODUzIDkxLjY2ODMgODAuMTkwNyA5MS40Mzc4IDgwLjUyNzggOTEuMTI0Mkw4MS43MzQxIDkxLjgxMzhDODEuOTI3OCA5MS45MjQ4IDgyLjE1NzMgOTEuOTU1IDgyLjM3MyA5MS44OTc3QzgyLjU4ODggOTEuODQwNSA4Mi43NzMzIDkxLjcwMDUgODIuODg3IDkxLjUwNzlDODIuOTQyNCA5MS40MTI4IDgyLjk3ODQgOTEuMzA3NiA4Mi45OTI4IDkxLjE5ODRDODMuMDA3MyA5MS4wODkyIDgyLjk5OTggOTAuOTc4MyA4Mi45NzExIDkwLjg3MkM4Mi45NDIzIDkwLjc2NTcgODIuODkyOSA5MC42NjYyIDgyLjgyNTQgOTAuNTc5M0M4Mi43NTc5IDkwLjQ5MjUgODIuNjczOCA5MC40MTk5IDgyLjU3ODEgOTAuMzY2Wk03Ny44NjY0IDkwLjA4NjFDNzcuNzIyOSA5MC4wMDUgNzcuNTk2OCA4OS44OTYxIDc3LjQ5NTYgODkuNzY1N0M3Ny4zOTQ0IDg5LjYzNTMgNzcuMzIwMiA4OS40ODYgNzcuMjc3MSA4OS4zMjY2Qzc3LjIzMzkgODkuMTY3MSA3Ny4yMjI4IDg5LjAwMDcgNzcuMjQ0MyA4OC44MzY5Qzc3LjI2NTggODguNjczMSA3Ny4zMTk3IDg4LjUxNTIgNzcuNDAyNiA4OC4zNzI0Qzc3LjU3MzUgODguMDg0IDc3Ljg1MDMgODcuODc0MyA3OC4xNzM2IDg3Ljc4ODNDNzguNDk3IDg3LjcwMjMgNzguODQxMSA4Ny43NDcgNzkuMTMyMSA4Ny45MTI2Qzc5LjI3NTYgODcuOTkzOCA3OS40MDE2IDg4LjEwMjcgNzkuNTAyOCA4OC4yMzMxQzc5LjYwNCA4OC4zNjM1IDc5LjY3ODIgODguNTEyNyA3OS43MjE0IDg4LjY3MjJDNzkuNzY0NSA4OC44MzE2IDc5Ljc3NTcgODguOTk4MSA3OS43NTQxIDg5LjE2MTlDNzkuNzMyNiA4OS4zMjU3IDc5LjY3ODcgODkuNDgzNiA3OS41OTU4IDg5LjYyNjNDNzkuNDI1IDg5LjkxNDkgNzkuMTQ4MiA5MC4xMjQ3IDc4LjgyNDggOTAuMjEwOEM3OC41MDE0IDkwLjI5NjkgNzguMTU3NCA5MC4yNTIzIDc3Ljg2NjQgOTAuMDg2N1Y5MC4wODYxWiIgZmlsbD0iIzg2QzNEQiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgMCkiLz48L2c+PGcgaWQ9IlJhaW5kcm9wcyI+PHBhdGggaWQ9IlJhaW5kcm9wIDEiIGQ9Ik01MiA4OFY5MSIgc3Ryb2tlPSIjMEE1QUQ0IiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgMTYpIi8+PHBhdGggaWQ9IlJhaW5kcm9wIDIiIGQ9Ik02NCA4OFY5MSIgc3Ryb2tlPSIjMEE1QUQ0IiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgMCkiLz48cGF0aCBpZD0iUmFpbmRyb3AgMyIgZD0iTTc2IDg4VjkxIiBzdHJva2U9IiMwQTVBRDQiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLCAxNikiLz48L2c+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfMzk3MjgiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PGNsaXBQYXRoIGlkPSJjbGlwMV8yMDQ1XzM5NzI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4='], // overcast-sleet.svg
  ['hail', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0ib3ZlcmNhc3QtaGFpbCIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzIwNDVfMzk2NjIpIj48ZyBpZD0iU2t5Ij48ZyBpZD0iQ2xvdWRzIiBjbGlwLXBhdGg9InVybCgjY2xpcDFfMjA0NV8zOTY2MikiPjxnIGlkPSJNYXNrIGdyb3VwIj48bWFzayBpZD0ibWFzazBfMjA0NV8zOTY2MiIgc3R5bGU9Im1hc2stdHlwZTphbHBoYSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMCIgeT0iMCIgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiPjxnIGlkPSJDbG91ZCBNYXNrIj48cGF0aCBpZD0iU3VidHJhY3QiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTI4IDBIMFYxMjhIMTI4VjBaTTM3Ljk1MTkgOTNIOTAuOTc1MkMxMDAuMjI3IDkzIDEwNy45OTggODUuMzUzIDEwNy45OTggNzYuMDI4MUMxMDcuOTk4IDY4LjAyMTcgMTAyLjMwNSA2MS4zNTAxIDk0LjkyNDggNTkuNTUxMkM5NS4zNjE5IDQ5LjkwMDUgODkuNjc0NCA0MC42MDkzIDgwLjU1MDkgMzYuNzkyMkM3MS4xMDcxIDMyLjg0MTEgNjAuMDY2NCAzNS42MTE5IDUzLjUzMDUgNDMuMjM4NEM0OC41NzAyIDQxLjU5NTYgNDIuOTgxNSA0Mi4yOTU3IDM4LjU3NDEgNDUuMjkwN0MzNC4xNDU5IDQ4LjI5OTggMzEuNDMwNSA1My4yODA5IDMxLjE4NDYgNTguNTM3OUMyNC4wNjMzIDYxLjQ2MyAxOS4zMjc4IDY4Ljg1MDYgMjAuMDc3NiA3Ni43ODM5QzIwLjk0MiA4NS45Mjk1IDI4LjgyODUgOTMuMDAxOCAzNy45NTE5IDkzWiIgZmlsbD0iYmxhY2siLz48L2c+PC9tYXNrPjxnIG1hc2s9InVybCgjbWFzazBfMjA0NV8zOTY2MikiPjxnIGlkPSJTZWNvbmRhcnkgQ2xvdWQiPjxwYXRoIGlkPSJDbG91ZCIgZD0iTTEwMS4xOTQgNTUuNTYyMUMxMDIuMzY3IDUxLjA1IDk5Ljc2MDIgNDYuNDIyNSA5NS41MDQzIDQ0LjcxMzNDOTEuMTkxOSA0Mi45ODEzIDg1Ljk2MTIgNDQuNDc0MyA4My40MTg2IDQ4LjQyM0M4MS4yNjQ4IDQ3LjE3OTcgNzguNDk2IDQ3LjI0OTYgNzYuNDExOSA0OC42MDlDNzQuMzgwOCA0OS45MzQgNzMuMjQzNCA1Mi4zNzIgNzMuNjc1IDU0Ljc3ODlDNzAuMjk5OCA1NS4zOTExIDY3LjY4NzQgNTguNDY4OCA2OC4wMzA3IDYxLjk1NjFDNjguMzc0OCA2NS40NTExIDcxLjUzOTQgNjguMDAwOCA3NC45NzY3IDY4QzgzLjgxMjYgNjggOTIuNjUxNCA2Ny45OTI1IDEwMS40ODggNjhDMTA0LjkxMSA2OCAxMDggNjUuMjg0OSAxMDggNjEuNzc0QzEwOCA1OC4xNDI4IDEwNC43MjEgNTUuNDE0MiAxMDEuMTk0IDU1LjU2MjFaIiBmaWxsPSIjQjBCQ0NEIi8+PC9nPjwvZz48L2c+PGcgaWQ9IkNsb3VkXzIiPjxwYXRoIGlkPSJDbG91ZF8zIiBkPSJNOTAuMzg4NiA2My4wODU2QzkyLjY4MzggNTMuODgxOSA4Ny43NDA4IDQ0LjEzNTcgNzkuMDA4NSA0MC40ODIyQzcwLjI2NTMgMzYuODI0MiA1OS44Mjc3IDQwLjEzNzUgNTQuODM3MiA0OC4yMTE1QzUwLjUzNjMgNDUuNjI1IDQ0Ljk3NTIgNDUuNzc4MSA0MC44MjM5IDQ4LjU5OTFDMzYuNjgzMiA1MS40MTI4IDM0LjQ5OTYgNTYuNTE0MyAzNS4zNDk5IDYxLjQ1MzlDMjguMzkyNiA2Mi43Njg1IDIzLjM5MzQgNjkuMzM5MyAyNC4wNjE0IDc2LjQwNzZDMjQuNzI5NyA4My40Nzc2IDMwLjg3MTggODkuMDAxOCAzNy45NTM0IDg5QzU1LjYwNjYgODkgNzMuMzA2IDg5IDkwLjk3NjcgODlDOTguMDQ0NiA4OSAxMDQgODMuMTE4OSAxMDQgNzYuMDI4MUMxMDQgNjguNzAxNSA5Ny42Nzc1IDYyLjc2NzQgOTAuMzg4NiA2My4wODU2WiIgZmlsbD0iI0U2RUZGQyIvPjwvZz48L2c+PC9nPjxnIGlkPSJQcmVjaXBpdGF0aW9uIj48ZyBpZD0iSWNlIGJhbGxzIj48cGF0aCBpZD0iSWNlIEJhbGwgMSIgZD0iTTUyIDg2QzUxLjQwNjcgODYgNTAuODI2NiA4Ni4xNzU5IDUwLjMzMzMgODYuNTA1NkM0OS44Mzk5IDg2LjgzNTIgNDkuNDU1NCA4Ny4zMDM4IDQ5LjIyODMgODcuODUyQzQ5LjAwMTMgODguNDAwMSA0OC45NDE5IDg5LjAwMzMgNDkuMDU3NyA4OS41ODUzQzQ5LjE3MzQgOTAuMTY3MiA0OS40NTkxIDkwLjcwMTggNDkuODc4NyA5MS4xMjEzQzUwLjI5ODMgOTEuNTQwOSA1MC44MzI5IDkxLjgyNjYgNTEuNDE0OCA5MS45NDI0QzUxLjk5NjggOTIuMDU4MSA1Mi41OTk4IDkxLjk5ODcgNTMuMTQ4IDkxLjc3MTZDNTMuNjk2MSA5MS41NDQ2IDU0LjE2NDcgOTEuMTYwMSA1NC40OTQ0IDkwLjY2NjdDNTQuODI0IDkwLjE3MzQgNTUgODkuNTkzMyA1NSA4OUM1NSA4OC4yMDQ0IDU0LjY4MzkgODcuNDQxMyA1NC4xMjEzIDg2Ljg3ODdDNTMuNTU4NyA4Ni4zMTYxIDUyLjc5NTcgODYgNTIgODZaIiBmaWxsPSIjODZDM0RCIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLCA4KSIvPjxwYXRoIGlkPSJJY2UgQmFsbCAyIiBkPSJNNjQgODZDNjMuNDA2NyA4NiA2Mi44MjY2IDg2LjE3NTkgNjIuMzMzMyA4Ni41MDU2QzYxLjgzOTkgODYuODM1MiA2MS40NTU0IDg3LjMwMzggNjEuMjI4MyA4Ny44NTJDNjEuMDAxMyA4OC40MDAxIDYwLjk0MTkgODkuMDAzMyA2MS4wNTc3IDg5LjU4NTNDNjEuMTczNCA5MC4xNjcyIDYxLjQ1OTEgOTAuNzAxOCA2MS44Nzg3IDkxLjEyMTNDNjIuMjk4MyA5MS41NDA5IDYyLjgzMjkgOTEuODI2NiA2My40MTQ4IDkxLjk0MjRDNjMuOTk2OCA5Mi4wNTgxIDY0LjU5OTggOTEuOTk4NyA2NS4xNDggOTEuNzcxNkM2NS42OTYxIDkxLjU0NDYgNjYuMTY0NyA5MS4xNjAxIDY2LjQ5NDQgOTAuNjY2N0M2Ni44MjQgOTAuMTczNCA2NyA4OS41OTMzIDY3IDg5QzY3IDg4LjIwNDQgNjYuNjgzOSA4Ny40NDEzIDY2LjEyMTMgODYuODc4N0M2NS41NTg3IDg2LjMxNjEgNjQuNzk1NyA4NiA2NCA4NloiIGZpbGw9IiM4NkMzREIiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAsIDApIi8+PHBhdGggaWQ9IkljZSBCYWxsIDMiIGQ9Ik03NiA4NkM3NS40MDY3IDg2IDc0LjgyNjYgODYuMTc1OSA3NC4zMzMzIDg2LjUwNTZDNzMuODM5OSA4Ni44MzUyIDczLjQ1NTQgODcuMzAzOCA3My4yMjgzIDg3Ljg1MkM3My4wMDEzIDg4LjQwMDEgNzIuOTQxOSA4OS4wMDMzIDczLjA1NzcgODkuNTg1M0M3My4xNzM0IDkwLjE2NzIgNzMuNDU5MSA5MC43MDE4IDczLjg3ODcgOTEuMTIxM0M3NC4yOTgzIDkxLjU0MDkgNzQuODMyOSA5MS44MjY2IDc1LjQxNDggOTEuOTQyNEM3NS45OTY4IDkyLjA1ODEgNzYuNTk5OCA5MS45OTg3IDc3LjE0OCA5MS43NzE2Qzc3LjY5NjEgOTEuNTQ0NiA3OC4xNjQ3IDkxLjE2MDEgNzguNDk0NCA5MC42NjY3Qzc4LjgyNCA5MC4xNzM0IDc5IDg5LjU5MzMgNzkgODlDNzkgODguMjA0NCA3OC42ODM5IDg3LjQ0MTMgNzguMTIxMyA4Ni44Nzg3Qzc3LjU1ODcgODYuMzE2MSA3Ni43OTU3IDg2IDc2IDg2WiIgZmlsbD0iIzg2QzNEQiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwgOCkiLz48L2c+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfMzk2NjIiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PGNsaXBQYXRoIGlkPSJjbGlwMV8yMDQ1XzM5NjYyIj48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4='], // overcast-hail.svg
  ['fog', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0iZm9nIiBjbGlwLXBhdGg9InVybCgjY2xpcDBfMjA0NV8zOTc4NSkiPjxnIGlkPSJTa3kiPjxnIGlkPSJDbG91ZHMiPjxnIGlkPSJDbG91ZCI+PHBhdGggaWQ9IkNsb3VkXzIiIGQ9Ik05MC4zODg2IDYzLjA4NTZDOTIuNjgzOCA1My44ODE5IDg3Ljc0MDggNDQuMTM1NyA3OS4wMDg1IDQwLjQ4MjJDNzAuMjY1MyAzNi44MjQyIDU5LjgyNzcgNDAuMTM3NSA1NC44MzcyIDQ4LjIxMTVDNTAuNTM2MyA0NS42MjUgNDQuOTc1MiA0NS43NzgxIDQwLjgyMzkgNDguNTk5MUMzNi42ODMyIDUxLjQxMjggMzQuNDk5NiA1Ni41MTQzIDM1LjM0OTkgNjEuNDUzOUMyOC4zOTI2IDYyLjc2ODUgMjMuMzkzNCA2OS4zMzkzIDI0LjA2MTQgNzYuNDA3NkMyNC43Mjk3IDgzLjQ3NzYgMzAuODcxOCA4OS4wMDE4IDM3Ljk1MzQgODlDNTUuNjA2NiA4OSA3My4zMDYgODkgOTAuOTc2NyA4OUM5OC4wNDQ2IDg5IDEwNCA4My4xMTg5IDEwNCA3Ni4wMjgxQzEwNCA2OC43MDE1IDk3LjY3NzUgNjIuNzY3NCA5MC4zODg2IDYzLjA4NTZaIiBmaWxsPSIjRTZFRkZDIi8+PC9nPjwvZz48L2c+PGcgaWQ9IlByZWNpcGl0YXRpb24iPjxwYXRoIGlkPSJMaW5lIDIiIGQ9Ik00MCA5NUg4OCIgc3Ryb2tlPSIjRTJFOEYwIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHBhdGggaWQ9IkxpbmUgMSIgZD0iTTQwIDEwM0g4OCIgc3Ryb2tlPSIjRTJFOEYwIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfMzk3ODUiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg=='], // fog.svg
  ['windy', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Zz48Zz48cGF0aCBkPSJNODcuNzkgNDAuMTM1MkM5My45NzU2IDMzLjM0NyAxMDUgMzguNDA0OSAxMDUgNDcuNDQ2M0MxMDUgNTMuMjc0NiAxMDAuNTIyIDU4IDk1IDU4SDI0IiBzdHJva2U9IiNFMkU4RjAiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNNjAuMTI4MSA4Ny44NjhDNjYuNDIwMiA5NC41MTg2IDc4IDg5Ljg3MTcgNzggODAuNTU1NkM3OCA3NC43MjYzIDczLjM1MDMgNzAgNjcuNjE1NCA3MEM2MS44ODA1IDcwIDI0IDcwIDI0IDcwIiBzdHJva2U9IiNFMkU4RjAiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L2c+PC9nPjwvc3ZnPg=='], // wind.svg
  ['windy-variant', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0idW1icmVsbGEtd2luZCIgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzIwNDVfNDg1MDIpIj48ZyBpZD0iVW1icmVsbGEiPjxwYXRoIGlkPSJVbWJyZWxsYSBTdGljayIgZD0iTTM4LjE0NzUgNzcuMTI0NkMzNi4zMjQzIDc4Ljk0NzggMzUuMjY2NyA4MS45MzU3IDM3LjQ4MzUgODQuMTUyNUMzOS43MDAzIDg2LjM2OTMgNDIuNjg4MyA4NS4zMTE3IDQ0LjUxMTQgODMuNDg4Nkw4Ni42Mjc0IDQxLjM3MjYiIHN0cm9rZT0iIzcxNzE3QSIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48ZyBpZD0iVW1icmVsbGEgVG9wIj48cGF0aCBpZD0iVmVjdG9yIiBkPSJNNjAuMjA3NSA1Mi44NzA4QzY3LjMxMTcgNTUuNTg5NyA3Mi4zNzU5IDYwLjU5NzYgNzUuMTI5NiA2Ny43OTI5Qzc1LjM0MjUgNjguMzQ5MSA3NS43NzU0IDY4Ljc5NTQgNzYuMzI4OSA2OS4wMTUxQzc2Ljg1OSA2OS4yMjU1IDc3LjM4MjggNjkuNDQzNSA3Ny44OTk1IDY5LjY3MDJDODkuOTMyMyA2MS4wMjggODYuNjI3NiA0MS4zNzI4IDg2LjYyNzYgNDEuMzcyOEM4Ni42Mjc2IDQxLjM3MjggNjYuOTc2NSAzOC4wNjg4IDU4LjMzMjkgNTAuMDk3MkM1OC41NTg5IDUwLjYxNjMgNTguNzc2MiA1MS4xNDE0IDU4Ljk4NTkgNTEuNjcxNEM1OS4yMDQ5IDUyLjIyNTIgNTkuNjUxMyA1Mi42NTc5IDYwLjIwNzUgNTIuODcwOFoiIGZpbGw9IiNGMUY1RjkiLz48ZyBpZD0iVmVjdG9yXzIiPjxwYXRoIGQ9Ik05NC45ODI2IDgzLjg5OTlDMTAzLjE2NyA3Mi44NjY2IDk5LjgwMiA1NC41NDcyIDg2LjYyNzQgNDEuMzcyNkM4Ni42Mjc0IDQxLjM3MjYgODkuOTMyMSA2MS4wMjc4IDc3Ljg5OTMgNjkuNjdDODMuODM0MSA3Mi4yNzM5IDg4LjgyMzggNzYuMDE4OCA5MS40NDA5IDgyLjM0MDFMOTEuODU2MiA4My4zNzk1QzkyLjM5MiA4NC43MjA1IDk0LjEyMDggODUuMDYxNiA5NC45ODI2IDgzLjg5OTlaIiBmaWxsPSIjRUY0NDQ0Ii8+PHBhdGggZD0iTTg2LjYyNzQgNDEuMzcyNkM3My40NTI4IDI4LjE5NzkgNTUuMTMzNCAyNC44MzI1IDQ0LjEwMDEgMzMuMDE3M0M0Mi45MzgzIDMzLjg3OTIgNDMuMjc5NSAzNS42MDggNDQuNjIwNSAzNi4xNDM4TDQ1LjY1OTkgMzYuNTU5MUM1Mi4wNzY1IDM5LjA5NjggNTUuNzY3NiA0NC4yMDYzIDU4LjMzMjcgNTAuMDk3QzY2Ljk3NjIgMzguMDY4NiA4Ni42Mjc0IDQxLjM3MjYgODYuNjI3NCA0MS4zNzI2WiIgZmlsbD0iI0VGNDQ0NCIvPjwvZz48L2c+PC9nPjxnIGlkPSJXaW5kIj48cGF0aCBpZD0iV2luZCBMaW5lIDEiIGQ9Ik00NC4zNTExIDQ3Ljg0MzZDNDcuMTAwMyA0NC45MzQ0IDUyIDQ3LjEwMjEgNTIgNTAuOTc3QzUyIDUzLjQ3NDggNTAuMDEgNTUuNSA0Ny41NTU2IDU1LjVIMTYiIHN0cm9rZT0iI0UyRThGMCIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGlkPSJXaW5kIExpbmUgMV8yIiBkPSJNMzIuMDU2OSA2OS4xNTc3QzM0Ljg1MzQgNzIuMDA4IDQwIDcwLjAxNjUgNDAgNjYuMDIzOEM0MCA2My41MjU2IDM3LjkzMzUgNjEuNSAzNS4zODQ2IDYxLjVDMzIuODM1OCA2MS41IDE2IDYxLjUgMTYgNjEuNSIgc3Ryb2tlPSIjRTJFOEYwIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfNDg1MDIiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg=='], // umbrella-wind.svg
  ['exceptional', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0idGhlcm1vbWV0ZXItYWxlcnQiIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8yMDQ1XzQ5MzAxKSI+PGcgaWQ9IlRoZXJtb21ldGVyIE1lcmN1cnkiPjxjaXJjbGUgaWQ9IlJlc2Vydm9pciIgY3g9IjY0IiBjeT0iODMiIHI9IjkiIGZpbGw9IiNEQzI2MjYiLz48cmVjdCBpZD0iVmFsdWUiIHg9IjYxIiB5PSI1MCIgd2lkdGg9IjYiIGhlaWdodD0iMjkiIHJ4PSIzIiBmaWxsPSIjREMyNjI2Ii8+PC9nPjxnIGlkPSJUaGVybW9tZXRlciBHbGFzcyI+PHBhdGggaWQ9IkdsYXNzIiBkPSJNNTAuNSA4My4xOTE0QzUwLjQ5NTIgODEuMDU2NiA1MS4wMTc1IDc4Ljk1MSA1Mi4wMjM0IDc3LjA1MThDNTMuMDI5NCA3NS4xNTI1IDU0LjQ5MDEgNzMuNTE0IDU2LjI4NDIgNzIuMjc1NEM1Ni40MTkzIDcyLjE4MjEgNTYuNDk5OSA3Mi4wMjg0IDU2LjUgNzEuODY0M1YzOC43NzkzQzU2LjUgMzYuODUzNCA1Ny4yODY0IDM1LjAwMjkgNTguNjkxNCAzMy42MzY3QzYwLjA5NjkgMzIuMjcgNjIuMDA2NCAzMS41IDY0IDMxLjVDNjUuOTkzNiAzMS41IDY3LjkwMzEgMzIuMjcgNjkuMzA4NiAzMy42MzY3QzcwLjcxMzYgMzUuMDAyOSA3MS41IDM2Ljg1MzQgNzEuNSAzOC43NzkzVjQyLjA0NjlINjVDNjQuNzIzOSA0Mi4wNDY5IDY0LjUgNDIuMjcwOCA2NC41IDQyLjU0NjlDNjQuNSA0Mi44MjMgNjQuNzIzOSA0My4wNDY5IDY1IDQzLjA0NjlINzEuNVY0OS44MjYySDY1QzY0LjcyMzkgNDkuODI2MiA2NC41IDUwLjA1IDY0LjUgNTAuMzI2MkM2NC41MDAxIDUwLjYwMjIgNjQuNzIzOSA1MC44MjYyIDY1IDUwLjgyNjJINzEuNVY1Ny42MDQ1SDY1QzY0LjcyNCA1Ny42MDQ1IDY0LjUwMDMgNTcuODI4NiA2NC41IDU4LjEwNDVDNjQuNSA1OC4zODA2IDY0LjcyMzkgNTguNjA0NSA2NSA1OC42MDQ1SDcxLjVWNzEuODM5OEM3MS41IDcyLjAwNCA3MS41ODA4IDcyLjE1NzYgNzEuNzE1OCA3Mi4yNTFDNzMuNTEzMiA3My40OTE5IDc0Ljk3NjMgNzUuMTM0NCA3NS45ODI0IDc3LjAzODFDNzYuOTg4NCA3OC45NDE2IDc3LjUwODYgODEuMDUxOCA3Ny41IDgzLjE5MDRWODMuMTkyNEM3Ny40OTk5IDkwLjU0MzEgNzEuNDgwMSA5Ni41IDY0IDk2LjVDNTYuNTE5OSA5Ni41IDUwLjUwMDEgOTAuNTQzMSA1MC41IDgzLjE5MjRWODMuMTkxNFoiIGZpbGw9IiNEQkVBRkUiIGZpbGwtb3BhY2l0eT0iMC4yNSIgc3Ryb2tlPSIjQkZEQkZFIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48ZyBpZD0iQWxlcnQiPjxwYXRoIGlkPSJFeGNsYW1hdGlvbiIgZD0iTTkxLjQwMTkgNDguNUM5Mi41NTY2IDQ2LjUgOTUuNDQzNCA0Ni41IDk2LjU5ODEgNDguNUwxMDguNzIyIDY5LjVDMTA5Ljg3NyA3MS41IDEwOC40MzQgNzQgMTA2LjEyNCA3NEg4MS44NzU2Qzc5LjU2NjIgNzQgNzguMTIyOSA3MS41IDc5LjI3NzYgNjkuNUw5MS40MDE5IDQ4LjVaIiBmaWxsPSIjMjAyOTM5Ii8+PHBhdGggaWQ9IkV4Y2xhbWF0aW9uTWFyayIgZD0iTTk0Ljc1ODIgNjQuNTlIOTMuMjY0Mkw5Mi40MTgyIDU5LjU2OFY1Ni4xODRIOTUuNTg2MlY1OS41NjhMOTQuNzU4MiA2NC41OVpNOTUuNjA0MiA2OUg5Mi40MDAyVjY1Ljk5NEg5NS42MDQyVjY5WiIgZmlsbD0id2hpdGUiLz48L2c+PC9nPjwvZz48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwXzIwNDVfNDkzMDEiPjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSJ3aGl0ZSIvPjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg=='], // thermometer-alert.svg
  ['unknown', 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI4IDEyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBpZD0idGhlcm1vbWV0ZXIiIGNsaXAtcGF0aD0idXJsKCNjbGlwMF8yMDQ1XzQ5Mjg2KSI+PGcgaWQ9IlRoZXJtb21ldGVyIE1lcmN1cnkiPjxjaXJjbGUgaWQ9IlJlc2Vydm9pciIgY3g9IjY0IiBjeT0iODMiIHI9IjkiIGZpbGw9IiNEQzI2MjYiLz48cmVjdCBpZD0iVmFsdWUiIHg9IjYxIiB5PSI1MCIgd2lkdGg9IjYiIGhlaWdodD0iMjkiIHJ4PSIzIiBmaWxsPSIjREMyNjI2Ii8+PC9nPjxnIGlkPSJUaGVybW9tZXRlciBHbGFzcyI+PHBhdGggaWQ9IkdsYXNzIiBkPSJNNTAuNSA4My4xOTE0QzUwLjQ5NTIgODEuMDU2NiA1MS4wMTc1IDc4Ljk1MSA1Mi4wMjM0IDc3LjA1MThDNTMuMDI5NCA3NS4xNTI1IDU0LjQ5MDEgNzMuNTE0IDU2LjI4NDEgNzIuMjc1NEM1Ni40MTkyIDcyLjE4MjEgNTYuNDk5OSA3Mi4wMjg0IDU2LjUgNzEuODY0M1YzOC43NzkzQzU2LjUgMzYuODUzNCA1Ny4yODY0IDM1LjAwMjkgNTguNjkxNCAzMy42MzY3QzYwLjA5NjkgMzIuMjcgNjIuMDA2NCAzMS41IDY0IDMxLjVDNjUuOTkzNSAzMS41IDY3LjkwMyAzMi4yNyA2OS4zMDg2IDMzLjYzNjdDNzAuNzEzNiAzNS4wMDI5IDcxLjUgMzYuODUzNCA3MS41IDM4Ljc3OTNWNDIuMDQ2OUg2NUM2NC43MjM5IDQyLjA0NjkgNjQuNSA0Mi4yNzA4IDY0LjUgNDIuNTQ2OUM2NC41IDQyLjgyMyA2NC43MjM4IDQzLjA0NjkgNjUgNDMuMDQ2OUg3MS41VjQ5LjgyNjJINjVDNjQuNzIzOCA0OS44MjYyIDY0LjUgNTAuMDUgNjQuNSA1MC4zMjYyQzY0LjUwMDEgNTAuNjAyMiA2NC43MjM5IDUwLjgyNjIgNjUgNTAuODI2Mkg3MS41VjU3LjYwNDVINjVDNjQuNzI0IDU3LjYwNDUgNjQuNTAwMiA1Ny44Mjg2IDY0LjUgNTguMTA0NUM2NC41IDU4LjM4MDYgNjQuNzIzOCA1OC42MDQ1IDY1IDU4LjYwNDVINzEuNVY3MS44Mzk4QzcxLjUgNzIuMDA0IDcxLjU4MDcgNzIuMTU3NiA3MS43MTU4IDcyLjI1MUM3My41MTMyIDczLjQ5MTkgNzQuOTc2MyA3NS4xMzQ0IDc1Ljk4MjQgNzcuMDM4MUM3Ni45ODg0IDc4Ljk0MTYgNzcuNTA4NiA4MS4wNTE4IDc3LjUgODMuMTkwNFY4My4xOTI0Qzc3LjQ5OTkgOTAuNTQzMSA3MS40ODAxIDk2LjUgNjQgOTYuNUM1Ni41MTk5IDk2LjUgNTAuNSA5MC41NDMxIDUwLjUgODMuMTkyNFY4My4xOTE0WiIgZmlsbD0iI0RCRUFGRSIgZmlsbC1vcGFjaXR5PSIwLjI1IiBzdHJva2U9IiNCRkRCRkUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvZz48L2c+PGRlZnM+PGNsaXBQYXRoIGlkPSJjbGlwMF8yMDQ1XzQ5Mjg2Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0id2hpdGUiLz48L2NsaXBQYXRoPjwvZGVmcz48L3N2Zz4='], // thermometer.svg
]);

if (!customElements.get(CARD)) {
  customElements.define(CARD+'-editor',FamilyHubLiveEditor);
  customElements.define(CARD,FamilyHubLive);
  (window.customCards ??= []).push({type:CARD,name:'Family Hub Live',description:'Family calendar, quick actions and live widgets'});
}
