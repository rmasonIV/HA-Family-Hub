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
| `daily_briefing` | Integration setting | Set to `false` to hide AI Briefing on this card. Set to `true` to show status even before setup or to use an existing YAML package. |
| `weather_entity` | Off | A `weather.*` entity supporting daily forecasts. Select **None** or omit the key to turn calendar weather off. |
| `default_view` | `week` | Initial calendar view. Use `week`, `month` for the full grid, or `month_details` to open Month with today’s details visible. |
| `week_start` | `monday` | First column in both views. Choose `monday` or `sunday`. |
| `actions` | Empty list | Up to four unique supported entity IDs. Actions support lights, switches, input booleans, scripts, buttons, input buttons, covers, and climate entities. Covers only offer opening from the closed state and ask for confirmation. |
| `action_appearance` | Domain icon and theme fill | Map action IDs to an optional `icon`, `off_color`, and `on_color`. Use `off_color` for actions other than toggles. Climate actions also accept an optional `name`. |
| `ribbon_default` | `expanded` | Starts Quick Actions `expanded` or `collapsed`. The header toggles it for the current visit. |
| `widgets` | Empty list | Up to four unique top-level built-in card configurations or entity IDs. |
| `widget_layout` | `grid` | Responsive side-by-side cards. Use `wide` for a full-width stack at every size. |
| `appearance.frame` | `off` | `retro_tv` surrounds the calendar with a woodgrain TV frame. |
| `appearance.seasonal_accent` | `off` | `christmas_retro` adds static holly sprigs to the upper perimeter. |

Click a calendar legend button to show just that calendar. Click a different button to switch calendars, or click the selected button again to restore all calendars. The choice follows you between Week and Month and applies to their day details. The card starts with all calendars visible.

In Week, use **‹** and **›** to move one week at a time. **This week** jumps back to the current week. The date range uses your configured Sunday or Monday start, and the card keeps the week you are browsing through a refresh or view switch. Forecast icons appear on dates with data from your provider. In Month, the current week has a slightly taller minimum row height, using the same configured week start and Home Assistant time zone.

In Month, today's date has its own marker and the selected date has a tinted cell. Forecast icons appear only for dates with data. Week, Month, and the detail pane use bundled static color icons from [Meteocons](https://github.com/basmilius/meteocons). Select a date to see its events and a full-width forecast panel with the condition, low, high, and temperature gradient. Close the pane with × or by selecting the same date again. The bar uses yellow for spans of at least 18°F or 10°C, and today's marker shows the current temperature when available. Week forecast icons open additional forecast details. Dates use Home Assistant's configured time zone, and temperature values and units come from Home Assistant.

Calendar events refresh every five minutes while the card is open. The refresh updates today's highlight and advances an open pane that was showing today. A pane showing a different date stays on that date. Home Assistant sends daily forecast updates through its weather subscription, and entity updates move the current-temperature marker.


## Family Assistant

1. Add or configure an **AI Task** in Home Assistant. For a local setup, start with the built-in Ollama integration and choose a model that supports structured output.
2. Open **Settings → Devices & services → Family Hub Light → Configure → Family Assistant**. Enable Assistant, select the AI Task, choose which calendars it can write to, and optionally choose a default. A calendar must support Home Assistant's **Create calendar event** action.
3. In Family Hub Live, select **Add event with Assistant**. Type a request such as “Soccer practice Friday at 6 PM for 90 minutes on Family.” Review the calendar, title, time, and any notes or location. Select **Create event** once the preview is correct.

After Home Assistant confirms the save, Family Hub Live shows the event immediately if its calendar and date are visible. Home Assistant refreshes the target calendar in the background, and the card rechecks the calendar for up to a minute if the provider is slow to list the event. The calendar result replaces the temporary display when it arrives. Calendar filters still apply. If the event disappears after the refresh attempts, check the target calendar before submitting it again.

The Assistant uses Home Assistant's time zone and shows a 60-minute default when a timed request omits an end time or duration. Say “all day” for an all-day event. Use **Edit request** or choose another calendar if the preview needs correction. Other built-in providers can use the same integration when their AI Task supports structured data. Provider credentials stay in Home Assistant. The selected provider receives the typed request, eligible calendar labels, locale, and time zone. Cloud models process that data externally. [Home Assistant AI Task](https://www.home-assistant.io/actions/ai_task.generate_data/) · [Ollama setup](https://www.home-assistant.io/integrations/ollama/)

Assistant requires a signed-in Home Assistant account, Family Hub's **Edit events** permission, and access to control the target calendar. Users sharing the kiosk share its account identity. A write from the Pi appears under its account, such as **Onlooker**, in Home Assistant Activity when Logbook and Recorder are enabled and include the calendar. Family Hub's info logs record the account ID for requests and write outcomes without event text. For a gathering, leave **Edit events** off for Onlooker or switch off **Enable Family Assistant**. Those controls govern Assistant access. Review the kiosk account's Home Assistant permissions separately for native calendar access.

This release creates one event at a time. If a save cannot be verified, check the target calendar before trying again. Follow-up ideas include a guest-mode calendar lock enforced on the server, a touch-friendly duration picker, event updates with an exact before-and-after preview, and deletion of a single identified event with an extra confirmation. Invitations require separate provider support. Future voice input can fill the same modal and use the same on-screen confirmation.

### Add an event from an image

1. In Home Assistant's **Ollama** integration, add an **AI Task** for a locally installed vision model. For the initial setup, choose `qwen3-vl:4b-instruct` on your self-hosted Ollama server and give the task a recognizable name such as **Flyer Reader**. [Ollama model details](https://ollama.com/library/qwen3-vl:4b-instruct)
2. In **Settings → Devices & services → Family Hub Light → Configure → Vision AI**, enable uploads and choose **Flyer Reader**. To switch models, select another Ollama AI Task here or change the model in the existing task's Ollama settings.
3. In **Configure → Family Assistant**, enable Assistant and select which calendars it can write to. The text AI Task is optional for image-only setups.
4. In **Add event with Assistant**, choose a photo or screenshot and select **Read image**. Edit the title, date, time, location and notes as needed. Check the displayed ambiguities, then select **Review event** and **Create event** to confirm.

For a first test, use a fictional flyer that says “Library workshop · December 5, 2026 · 2:00–3:30 PM · Main Library.” Try removing the time to check that the draft asks you to fill it in. Timed image drafts require an explicit start and either an end or a duration. Mark an event as all day only if that's intended. Dates and times use Home Assistant's time zone, which is shown in the draft. Model confidence is a self-assessment, so compare the draft with the original before saving.

Vision AI accepts one JPEG, PNG or WebP image up to 2 MB and 20 megapixels. Family Hub strips metadata and sends the image and Home Assistant time zone to the configured Ollama server. Keep that server self-hosted and disable its cloud features if you use it for private photos. Family Hub keeps the upload in memory for inference. Calendar labels, existing events and credentials stay out of the vision request, and the image is not attached to the saved calendar event.

## Calendar appearance

Choose **Frame** and **Seasonal accent** under **Calendar appearance** in the visual editor, or edit the card YAML.

```yaml
type: custom:family-hub-live
calendars:
  - calendar.family
default_view: month
appearance:
  frame: retro_tv
  seasonal_accent: christmas_retro
```

Set `seasonal_accent: off` to keep the TV frame year-round, or use `frame: off` for holly with a thin green outline. Omitting `appearance` turns both options off. Seasonal accents are selected manually. The decoration scales with the card width, and Quick Actions and Quick Widgets sit outside it.

In the pull request preview, append `?frame=retro_tv&seasonal_accent=christmas_retro` to the preview URL to see both options with sample events.

## AI daily briefing

Select a date in Week or Month to see its schedule. Day details show potential overlaps between timed events on visible calendars, even with AI disabled. Events that meet at an endpoint and all-day events are excluded from overlap checks. When enabled, the briefing and its generation time appear above the event list. The briefing uses its own calendar list, independent of the card's legend filter. The managed briefing shows its approved calendars and flags days with events outside that list. With the YAML package, check the script's `calendar_ids` for the approved sources. Both modes use the selected date in Home Assistant's time zone. A verified empty schedule names the date. Failed calendar retrieval and AI responses that explicitly contradict a nonempty schedule show an error.

The integration formats dates and event times for the AI using Home Assistant's configured language and country. For example, US English uses Sunday, November 22, 2026 and 3:30 PM. If the region is unavailable, the integration uses the language's default formats, with English as a fallback. The card shows the generation timestamp in the Home Assistant server time zone using your profile's language and time format. An explicit 12-hour or 24-hour profile setting overrides the locale default. The card falls back to the browser locale if Home Assistant supplies no usable language. Stored dates and timestamps continue to use ISO format.

### Configure AI Briefing in Home Assistant

1. Set up a Home Assistant AI Task provider. In **Developer Tools → Actions**, test `ai_task.generate_data` with the provider's `ai_task.*` entity and a harmless prompt. Confirm that the response contains text in `data`. [Home Assistant Generate data action](https://www.home-assistant.io/actions/ai_task.generate_data/)
2. Open **Settings → Devices & services → Family Hub Light → Configure → AI Briefing**. Choose the AI Task and the calendars it can summarize. You can add or remove calendars here later.
3. Optionally select a weather entity that supports daily forecasts and change the scheduled time (default **05:00** in Home Assistant's time zone). Enable event titles or locations only if you want those fields included. Both start off.
4. Turn on **Enable AI Briefing** and submit. Open today's details on a Family Hub Live card and select **Generate briefing**, or **Refresh briefing** if today's run has already finished.

### Move from the YAML package

If you already use the [YAML package](packages/family_hub_briefing.yaml), turn off its `input_boolean.family_hub_briefing_enabled` helper before enabling the integration settings to avoid two scheduled runs. Select the AI Task, calendars and other settings in **Configure → AI Briefing**. Existing installations can continue using the package until they save integration settings. Once you have verified the new setup, you can remove the old package file at your next planned Home Assistant restart.

### AI Task providers

Add the provider through **Settings → Devices & services**, then add or select its data-generating AI Task. Choose the AI Task entity assigned by your installation in Family Hub's **AI Task** picker. API credentials belong in the provider integration setup.

#### Ollama on your local network

Give Home Assistant the address of your Ollama host. In the proof of concept on a Mac mini, `qwen3:8b` gave more useful summaries than `gemma3:4b`, with longer waits. Select the model in the Ollama AI Task settings. [Home Assistant Ollama integration](https://www.home-assistant.io/integrations/ollama/)

#### OpenAI

Set up the OpenAI integration with an OpenAI API key and API billing. A ChatGPT consumer or business subscription and OpenAI API access are billed separately. [Home Assistant OpenAI integration](https://www.home-assistant.io/integrations/openai_conversation/), [OpenAI billing](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)

#### Anthropic Claude

Use an Anthropic Console API key and API credits or billing. Claude subscriptions and Anthropic API billing are separate. Eligible plans may have API credits that can be claimed in Console. [Home Assistant Anthropic integration](https://www.home-assistant.io/integrations/anthropic/), [Anthropic billing](https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan)

#### Google Gemini

Use a Gemini API key and check the API project's quota and billing. Google AI consumer subscriptions and Gemini API project billing are separate. [Home Assistant Google Gemini integration](https://www.home-assistant.io/integrations/google_generative_ai_conversation/), [Gemini AI Task implementation](https://github.com/home-assistant/core/blob/dev/homeassistant/components/google_generative_ai_conversation/ai_task.py), [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)

### Refresh, storage, and privacy

- The integration checks at the configured time, every 15 minutes after it, and when it starts after the scheduled time. An unchanged successful briefing is reused. **Refresh briefing** requests a new result, with a 30-second reuse window for matching requests.
- Today's last successful briefing survives a restart and appears on cards for users with read access to the selected calendars and forecast. Future briefings live in the open card's memory. An empty day with no forecast gets a fixed message without an AI call.
- The AI provider receives information from the selected calendars, including times and all-day flags. Titles and locations are optional. Event notes are omitted. If the provider is cloud-hosted, the included data leaves Home Assistant. Make calendar and privacy changes in **Configure → AI Briefing**.

## Mealie recipe details

Keep your Mealie Dinner entity in `calendars`. Add this optional block in the card's YAML editor to show the dinner title, a thumbnail and short recipe description when available, and an **Open in Mealie** link. These appear in the Month selected-day pane and in Week day details alongside AI Briefing when it is enabled.

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
- The card reads only the selected date through Home Assistant’s `mealie.get_mealplan` action when a dinner event is visible. Week and Month share the lookup for five minutes. The action supplies the recipe description directly. A plain meal note or an ambiguous recipe match appears as a regular event. No additional Mealie token is needed.
- The dashboard browser loads thumbnails directly from the Mealie URL, so the tablet or computer must be able to reach that address on your LAN. Use a trusted HTTPS Mealie URL if you open Home Assistant over HTTPS, since the browser may block HTTP images on an HTTPS page. The recipe opens in a new tab using your normal Mealie login. If the thumbnail fails, the card tries the full-size Mealie image. If both fail, the title, available description and recipe link remain visible. If Home Assistant cannot return the meal plan, check the instance ID and the **Get mealplan** action with the same Home Assistant account used on the dashboard.

## Thermostat Quick Actions

After installing a version with thermostat Quick Actions, select the thermostat in the visual editor or add its entity ID to the card's existing `actions` list.

```yaml
actions:
  - switch.living_room
  - climate.smart_thermostat_250721009116476012
action_appearance:
  climate.smart_thermostat_250721009116476012:
    name: Thermostat
    icon: mdi:thermostat
```

Quick Actions tiles size to their contents and wrap on narrow dashboards. The thermostat shows a smaller indoor reading beneath its name. Tap the name or the indoor reading to open Home Assistant’s climate details. Use the adjacent 44 × 44 px minus and plus buttons to adjust the target displayed between them. Heat and Cool use one stepper. Heat/Cool stacks separate low and high steppers. The buttons use the entity's temperature limits and step, with a one-degree step if none is reported. The active HVAC mode stays as set in Home Assistant. The tile is read-only in other modes or when the entity lacks the required setpoint data. A failed service call appears on the tile, and the readings follow Home Assistant state updates.

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

From the repository root, install the pinned screenshot dependency and its Chromium build, then regenerate the seven preview images. Open the preview with `?briefing` to enable the fictional briefing fixture.

```sh
npm ci --prefix preview
npm --prefix preview exec -- playwright install chromium
npm run capture --prefix preview
```

The harness checks Week and Month at desktop and phone widths, verifies the Mealie Dinner filter through a view switch, exercises current and future briefings, and writes PNGs to `images/live/`. The date, time zone, locale, viewport and device scale are fixed. Font rendering can differ by operating system. The harness opens a local file and blocks HTTP(S) requests.

With Home Assistant Core 2026.11 installed in a test environment, run `python tests/check_briefing_package.py` to exercise the package with a temporary Local Calendar, synthetic AI responses, and a restart. Install the Babel version listed in the integration manifest, then run `python -B -m unittest discover -s tests -p check_briefing_locale.py` to check the managed briefing's locale formatting.

See the [Mealie assessment and Kitchen V1 proposal](KITCHEN_V1.md) for the next design review.
