# Family Hub Live

Family Hub Live combines a Week or Month calendar, Quick Actions, and built-in Home Assistant widgets. It follows the active Home Assistant theme.

## Add it to your dashboard

1. Install or update the `rmasonIV/HA-Family-Hub` integration through HACS, then restart Home Assistant.
2. Open the dashboard in edit mode and add **Family Hub Live**. Choose a **Panel** view if this card should fill a dedicated wall display.
3. Select calendars, Quick Actions, widget entities, and a weather entity in the visual editor. For full widget card options, switch to **Show code editor** and edit `widgets` as YAML.

The integration registers the resource automatically for UI-managed dashboards. For YAML-managed resources, load `/family_hub/family-hub-live.js` as a JavaScript module. Remove any older manual resource for the same card before loading the integration-managed copy.

To test a development checkout on a Home Assistant installation that already has Family Hub Live, copy the branch's `custom_components/family_hub/card/family-hub-live.js` to the Home Assistant `www` directory under a distinct filename. Temporarily replace the existing Family Hub Live dashboard resource with that file's `/local/…` URL, configured as a JavaScript module. Keep a copy of the original resource entry and restore it after testing. Reload the frontend after switching resources.

## Settings

| Key | Default | Behavior |
| --- | --- | --- |
| `calendars` | Empty list | Home Assistant `calendar.*` entity IDs, in legend order. |
| `calendar_colors` | Rotating palette | Map calendar IDs to quoted six-digit hex colors. The same color appears in the legend, cells, and event details. |
| `daily_briefing` | `false` | Show the opt-in AI briefing in day details. Requires the [briefing package](#ai-daily-briefing). |
| `weather_entity` | Off | A `weather.*` entity supporting daily forecasts. Select **None** or omit the key to turn calendar weather off. |
| `default_view` | `week` | Initial calendar view. Use `week`, `month` for the full grid, or `month_details` to open Month with today’s details visible. |
| `week_start` | `monday` | First column in both views. Choose `monday` or `sunday`. |
| `actions` | Empty list | Up to four unique supported entity IDs. Actions support lights, switches, input booleans, scripts, buttons, input buttons, and covers. Covers only offer opening from the closed state and ask for confirmation. |
| `action_appearance` | Domain icon and theme fill | Map action IDs to an optional `icon`, `off_color`, and `on_color`. Use `off_color` for actions other than toggles. |
| `ribbon_default` | `expanded` | Starts Quick Actions `expanded` or `collapsed`. The header toggles it for the current visit. |
| `widgets` | Empty list | Up to four unique top-level built-in card configurations or entity IDs. |
| `widget_layout` | `grid` | Responsive side-by-side cards. Use `wide` for a full-width stack at every size. |

Click a calendar legend button to show just that calendar. Click a different button to switch calendars, or click the selected button again to restore all calendars. The choice follows you between Week and Month and applies to their day details. The card starts with all calendars visible.

In Week, use **‹** and **›** to move one week at a time. **This week** jumps back to the current week. The date range uses your configured Sunday or Monday start, and the card keeps the week you are browsing through a refresh or view switch. Forecast icons appear on dates with data from your provider.

In Month, today's date has its own marker and the selected date has a tinted cell. Forecast icons appear only for dates with data. Week, Month, and the detail pane use bundled static color icons from [Meteocons](https://github.com/basmilius/meteocons). Select a date to see its events and a full-width forecast panel with the condition, low, high, and temperature gradient. Close the pane with × or by selecting the same date again. The bar uses yellow for spans of at least 18°F or 10°C, and today's marker shows the current temperature when available. Week forecast icons open additional forecast details. Dates use Home Assistant's configured time zone, and temperature values and units come from Home Assistant.

Calendar events refresh every five minutes while the card is open. The refresh updates today's highlight and advances an open pane that was showing today. A pane showing a different date stays on that date. Home Assistant sends daily forecast updates through its weather subscription, and entity updates move the current-temperature marker.

## AI daily briefing

Select a date in Week or Month to see its schedule. Day details show potential overlaps between timed events on visible calendars, even with AI disabled. Events that meet at an endpoint and all-day events are excluded from overlap checks. When enabled, the briefing and its generation time appear above the event list. The briefing uses its own calendar list, independent of the card's legend filter.

### Install the Home Assistant package

1. Set up one of the AI Task providers below. In **Developer tools → Actions**, run `ai_task.generate_data` with the provider's `ai_task.*` entity and a harmless prompt. Confirm that the response contains text in `data`. [Home Assistant Generate data action](https://www.home-assistant.io/actions/ai_task.generate_data/)
2. Copy [family_hub_briefing.yaml](packages/family_hub_briefing.yaml) to `/config/packages/family_hub_briefing.yaml`. If you already use packages, use your existing packages directory and include. Otherwise add this to `configuration.yaml` under your existing `homeassistant:` section.

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

3. Edit the package's first script step. Set `calendar_ids` to the calendars you want summarized and `ai_entity` to the AI Task entity from step 1. Set `include_titles` and `include_locations` to suit your household. To change the default **05:00** Home Assistant local time, replace the quoted time on the `at: &briefing_time` line.
4. Check configuration, restart Home Assistant, and turn on `input_boolean.family_hub_briefing_enabled` when ready. Keep the package entity IDs as supplied. In the Family Hub Live card's YAML editor, add `daily_briefing: true`.

   ```yaml
   type: custom:family-hub-live
   default_view: month_details
   calendars:
     - calendar.family
     - calendar.school
   daily_briefing: true
   ```

### Provider YAML examples

Add the provider through **Settings → Devices & services**, then add or select its data-generating AI Task. In the package, use **one** of the `ai_entity` examples below, replacing the example ID with the entity ID assigned by your installation. API credentials belong in the provider integration setup.

```yaml
# Ollama on your local network
ai_entity: ai_task.ollama_ai_task
```

Give Home Assistant the address of your Ollama host. In the proof of concept on a Mac mini, `qwen3:8b` gave more useful summaries than `gemma3:4b`, with longer waits. Select the model in the Ollama AI Task settings. [Home Assistant Ollama integration](https://www.home-assistant.io/integrations/ollama/)

```yaml
# OpenAI
ai_entity: ai_task.openai_ai_task
```

Set up the OpenAI integration with an OpenAI API key and API billing. A ChatGPT consumer or business subscription and OpenAI API access are billed separately. [Home Assistant OpenAI integration](https://www.home-assistant.io/integrations/openai_conversation/), [OpenAI billing](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)

```yaml
# Anthropic Claude
ai_entity: ai_task.claude_ai_task
```

Use an Anthropic Console API key and API credits or billing. Claude subscriptions and Anthropic API billing are separate. Eligible plans may have API credits that can be claimed in Console. [Home Assistant Anthropic integration](https://www.home-assistant.io/integrations/anthropic/), [Anthropic billing](https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan)

```yaml
# Google Gemini
ai_entity: ai_task.google_ai_task
```

Use a Gemini API key and check the API project's quota and billing. Google AI consumer subscriptions and Gemini API project billing are separate. [Home Assistant Google Gemini integration](https://www.home-assistant.io/integrations/google_generative_ai_conversation/), [Gemini AI Task implementation](https://github.com/home-assistant/core/blob/dev/homeassistant/components/google_generative_ai_conversation/ai_task.py), [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)

### Refresh, storage, and privacy

- The package checks at the configured time and every 15 minutes after it. It hashes normalized briefing inputs, including the prompt version, and skips generation when today's inputs match the stored result. **Refresh briefing** requests a new result on demand. Matching requests within 30 seconds reuse the current result, and the script runs one request at a time.
- A successful briefing for today is shared via `sensor.family_hub_daily_briefing` and survives Home Assistant restarts. Its live state clears at midnight, or at startup if the saved date has passed. Future-day briefings are generated on request and live in the open card's memory. Past days show calendar details. [Home Assistant template sensor restoration](https://www.home-assistant.io/integrations/template/#trigger-based-template-entities)
- A successfully loaded empty day gets a fixed message without an AI call. If calendar fetching or generation fails, events remain usable and a manual request displays an error. Today's last successful briefing remains visible with its original timestamp.
- Only allowlisted calendars contribute to the prompt. Event times and all-day flags are included. Titles default to on, locations default to off, and notes are omitted. For cloud providers, the included data leaves your Home Assistant. Shared briefing text is readable by Home Assistant users who can read the sensor. Turn off the helper to stop generation and clear the live sensor. The package excludes the sensor from Recorder history. Home Assistant's restore storage and provider retention still apply. [Home Assistant Recorder exclusions](https://www.home-assistant.io/integrations/recorder/#exclude)

## Mealie recipe details

Keep your Mealie Dinner entity in `calendars`. Add this optional block in the card's YAML editor to show a recipe thumbnail when available and an **Open in Mealie** link in Week day details and the Month details pane.

```yaml
mealie:
  calendar: calendar.mealie_dinner
  config_entry_id: YOUR_HOME_ASSISTANT_MEALIE_CONFIG_ENTRY_ID
  url: https://meals.example.com
  group: home
```

- **Calendar** is the same entity ID already listed under `calendars`.
- **Config entry ID** identifies the existing Home Assistant integration. In Home Assistant, select **Mealie: Get mealplan** in the automation editor, choose your Mealie instance, then switch that action to YAML to read its `config_entry_id`. Use the same instance that supplies the dinner calendar.
- **URL** is the browser-accessible Mealie base address without a recipe path. **Group** is the segment after `/g/` when you open a recipe in Mealie. For example, use `home` for a recipe URL containing `/g/home/r/`.
- The card reads the selected date through Home Assistant and uses the returned recipe to enrich a matching dinner title. A plain meal note or an ambiguous recipe match appears as a regular event. No additional Mealie token is needed.
- The recipe opens in a new tab using your normal Mealie login. If an image is missing or the browser cannot load it, the title and recipe link remain available. If Home Assistant cannot return the meal plan, check the instance ID and the **Get mealplan** action with the same Home Assistant account used on the dashboard.

## Quick Widgets

| Built-in card | Typical setup |
| --- | --- |
| `weather-forecast` | `entity: weather.home`, with optional `forecast_type: daily`. |
| `thermostat` | `entity: climate.downstairs`. |
| `gauge` | Numeric sensor with optional `min`, `max`, and severity thresholds. |
| `tile` | One entity, such as `binary_sensor.front_door`, with optional native tile settings. |
| `sensor` | `sensor.*` entity. |
| `entities` | An `entities` list of built-in rows. The entire card counts as one widget. |

Each YAML mapping is passed to the corresponding Home Assistant card. Use the card's standard options. Third-party cards and rows, nested cards, and layout containers are unsupported inside Quick Widgets. A separate dashboard card can sit below Family Hub Live. The calendar's `weather_entity` is independent of any optional weather widget, which manages its own Home Assistant display.

In `grid` mode, one card fills the row, two sit side by side, three use three columns, and four use two rows of two. Three columns reduce to two at 720 px of available layout width. At 480 px and below, cards stack. The Quick Actions ribbon keeps its existing four-column layout and switches to two columns at 620 px. Month moves its details below the calendar on narrow displays.

Family Hub uses Home Assistant's card helpers to create each widget and keeps the same instances through forecast updates, event refreshes, and view switches. Its CSS layout responds to the available width. Home Assistant's Grid card has a configured column count and defaults to square cells, so this layout uses CSS to give the native cards room to size themselves. [Home Assistant Grid card](https://www.home-assistant.io/dashboards/grid/)

### YAML presets

#### Compact week

```yaml
type: custom:family-hub-live
default_view: week
week_start: monday
ribbon_default: collapsed
calendars:
  - calendar.family
  - calendar.school
  - calendar.mealie_dinner
```

#### Wall display with month details

Replace the sample entity IDs with yours. Quote colors so YAML reads them as strings.

```yaml
type: custom:family-hub-live
calendars:
  - calendar.family
  - calendar.school
calendar_colors:
  calendar.family: "#4a90e2"
  calendar.school: "#2ba675"
weather_entity: weather.home
default_view: month_details
week_start: sunday
ribbon_default: collapsed
actions:
  - light.living_room
  - cover.garage
action_appearance:
  light.living_room:
    icon: mdi:lamps
    off_color: "#64748b"
    on_color: "#f59e0b"
widget_layout: grid
widgets:
  - type: weather-forecast
    entity: weather.home
    forecast_type: daily
  - type: thermostat
    entity: climate.downstairs
  - type: gauge
    entity: sensor.living_room_humidity
    min: 0
    max: 100
  - binary_sensor.front_door
```

This alternate widget list uses the other supported card formats. Replace the existing `widgets` block with it when testing these formats.

```yaml
widgets:
  - type: tile
    entity: light.living_room
    name: Living room
  - type: sensor
    entity: sensor.outdoor_temperature
  - type: entities
    title: Entry
    entities:
      - binary_sensor.front_door
      - sensor.hall_temperature
```

### Migration and troubleshooting

- Remove a legacy top-level `title:` from the Family Hub Live card YAML when convenient. Existing dashboards load with the key silently ignored, and saving a change through the visual editor drops it. Set the heading on the Home Assistant dashboard view. Widget-level titles, such as the **Entry** example above, still apply.

- Existing widget IDs can stay as strings. A `weather.*` ID opens a Weather Forecast card, a `climate.*` ID opens a Thermostat card, a `sensor.*` ID opens a Sensor card, and other IDs open a Tile card. Tiles and thermostats may provide native controls according to Home Assistant permissions. To require a particular presentation, specify the card type in YAML.
- Existing calendar colors, action appearance, ribbon defaults, and `wide` layouts continue to work. Existing `grid` layouts automatically use the new count-based layout.
- The card skips invalid list entries and duplicates before applying the four-item limits. The first four valid unique actions and widgets are used in YAML order. Equivalent widget mappings are deduplicated even when their key order differs. Two different card configurations may use the same entity. Check the card's configuration message for skipped entries or invalid settings.
- A missing or unavailable entity may appear as unavailable in its native card. If one widget cannot initialize, check its YAML in a standalone Home Assistant card, correct the entity or options, and save the dashboard. Reload the frontend if card loading failed across all slots.
- If weather is blank, check that the selected entity provides a **daily** forecast in Home Assistant. Days beyond that provider's forecast window have no weather display. A standalone widget's forecast mode is set on its own YAML mapping.
- If events seem missing, check the selected calendar legend button, the relevant calendar entity, and Home Assistant's configured time zone.

## Screenshots and test data

Open [the interactive preview](../preview/live.html) from a checkout to try the real card with fictional June 2026 data. The browser uses fake Home Assistant calendar, forecast, and state responses. Native Home Assistant icons and Quick Widget cards have lightweight stand-ins, so the captures verify the Live card layout and widget placement. The pre-existing Kitchen concept in the interactive preview is hidden during captures.

From the repository root, install the pinned screenshot dependency and its Chromium build, then regenerate the six preview images. Open the preview with `?briefing` to enable the fictional briefing fixture.

```sh
npm ci --prefix preview
npm --prefix preview exec -- playwright install chromium
npm run capture --prefix preview
```

The harness checks Week and Month at desktop and phone widths, verifies the Mealie Dinner filter through a view switch, exercises current and future briefings, and writes PNGs to `images/live/`. The date, time zone, locale, viewport and device scale are fixed. Font rendering can differ by operating system. The harness opens a local file and blocks HTTP(S) requests.

With Home Assistant Core 2026.11 installed in a test environment, run `python tests/check_briefing_package.py` to exercise the package with a temporary Local Calendar, synthetic AI responses, and a restart.

See the [Mealie assessment and Kitchen V1 proposal](KITCHEN_V1.md) for the next design review.
