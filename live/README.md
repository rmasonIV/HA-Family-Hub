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
| `weather_entity` | Off | A `weather.*` entity supporting daily forecasts. Select **None** or omit the key to turn calendar weather off. |
| `default_view` | `week` | Initial calendar view, either `week` or `month`. |
| `week_start` | `monday` | First column in both views. Choose `monday` or `sunday`. |
| `actions` | Empty list | Up to four unique supported entity IDs. Actions support lights, switches, input booleans, scripts, buttons, input buttons, and covers. Covers only offer opening from the closed state and ask for confirmation. |
| `action_appearance` | Domain icon and theme fill | Map action IDs to an optional `icon`, `off_color`, and `on_color`. Use `off_color` for actions other than toggles. |
| `ribbon_default` | `expanded` | Starts Quick Actions `expanded` or `collapsed`. The header toggles it for the current visit. |
| `widgets` | Empty list | Up to four unique top-level built-in card configurations or entity IDs. |
| `widget_layout` | `grid` | Responsive side-by-side cards. Use `wide` for a full-width stack at every size. |

Click a calendar legend button to show just that calendar. Click a different button to switch calendars, or click the selected button again to restore all calendars. The choice follows you between Week and Month and applies to their day details. The card starts with all calendars visible.

In Month, today's date has its own marker and the selected date has a tinted cell. Forecast icons appear only for dates with data. Select a date to show its events and the same high, low, and temperature gradient used in Week. The bar uses yellow for spans of at least 18°F or 10°C, and today's marker shows the current temperature when available. Week forecast icons open additional forecast details. Dates use Home Assistant's configured time zone, and temperature values and units come from Home Assistant.

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

### YAML example

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
default_view: month
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

- Existing widget IDs can stay as strings. A `weather.*` ID opens a Weather Forecast card, a `climate.*` ID opens a Thermostat card, a `sensor.*` ID opens a Sensor card, and other IDs open a Tile card. Tiles and thermostats may provide native controls according to Home Assistant permissions. To require a particular presentation, specify the card type in YAML.
- Existing calendar colors, action appearance, ribbon defaults, and `wide` layouts continue to work. Existing `grid` layouts automatically use the new count-based layout.
- The card skips invalid list entries and duplicates before applying the four-item limits. The first four valid unique actions and widgets are used in YAML order. Equivalent widget mappings are deduplicated even when their key order differs. Two different card configurations may use the same entity. Check the card's configuration message for skipped entries or invalid settings.
- A missing or unavailable entity may appear as unavailable in its native card. If one widget cannot initialize, check its YAML in a standalone Home Assistant card, correct the entity or options, and save the dashboard. Reload the frontend if card loading failed across all slots.
- If weather is blank, check that the selected entity provides a **daily** forecast in Home Assistant. Days beyond that provider's forecast window have no weather display. A standalone widget's forecast mode is set on its own YAML mapping.
- If events seem missing, check the selected calendar legend button, the relevant calendar entity, and Home Assistant's configured time zone.

## Screenshots and test data

The main README's existing screenshots show earlier or upstream interfaces. Refresh captures once the feature branch is stable. Use the fictional data in `preview/live.html` to check layouts, then capture the real Home Assistant UI with synthetic calendars, weather, and devices to show the native cards. Keep real family events, names, event notes, and locations out of captures.
