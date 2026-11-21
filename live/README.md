# Family Hub Live

Family Hub Live combines a Week or Month calendar, Quick Actions, and live entity widgets in one Home Assistant card. The layout follows your active Home Assistant theme.

## Add it to your dashboard

1. Update the `rmasonIV/HA-Family-Hub` integration through HACS and restart Home Assistant.
2. Open your dashboard in edit mode and add **Family Hub Live**. Use a Panel view if you want the calendar to fill the view.
3. Select your calendars, actions, and widgets in the card editor, then save. If you are replacing an existing calendar card, remove it after saving the new card.

The integration registers the card automatically for UI-managed dashboard resources. For YAML-managed resources, register `/family_hub/family-hub-live.js` as a JavaScript module. If you previously added the manual `/local/family-hub-live/` resource, remove it so the dashboard loads the integration-managed copy.

## Configure the layout

- **Calendars** receive distinct default colors for the first eight calendars. Use the color picker next to each calendar name to override its color. The legend identifies calendars by their Home Assistant names, and the same colors appear in Week, Month, and event details.
- **Quick Actions** holds up to four buttons. Wide layouts reserve four slots, and narrow layouts use two columns. Tap the header to collapse or expand the actions. Choose an icon from the suggestions or enter an MDI icon name. Set separate On and Off fills for toggles, or a single fill for other actions. **Use theme** restores the default fill. Supported actions include toggling lights and switches, running scripts, pressing buttons, and opening closed covers after confirmation.
- **Quick Widgets** displays up to four entity states. The side-by-side layout reserves four slots on wide screens and two on narrow screens, even when fewer widgets are configured. Choose the full-width stack to make each widget span the card. A complete Lovelace card such as `custom:pollenprognos-card` can be placed below Family Hub Live in a Vertical Stack.
- **Week weather** adds the daily forecast from a selected `weather.*` entity. Choose a provider that supports daily forecasts. Week view shows the icon and available high and low temperatures beside events. The temperature bar runs from blue at the low to red at the high. Yellow marks the midpoint when the range is at least 18°F or 10°C. Today’s dot follows the weather entity’s current temperature. Tap the icon for forecast details. Days outside the provider’s forecast window continue to show events. Choose **None** to turn weather off.
- **Startup defaults** controls whether the calendar opens in Week or Month and whether Quick Actions starts expanded or collapsed. The defaults are Week and Expanded. Tap the Quick Actions header to change its state for the current visit. Tap a date in Week to open its events in a dialog. In Month, tapping a date opens the details panel.

## Wall displays and phones

Set the dashboard view to **Panel** for a dedicated wall calendar. Panel gives its single card the available width, and Family Hub Live adjusts its padding and layout to fit. On shorter screens, Month uses more compact rows. Home Assistant's header and sidebar are outside the card.

On a phone in portrait, Week stacks day cards vertically. Month keeps seven columns with colored event markers. Tap a date to open the full event list below the grid. Quick Actions uses two columns on narrow screens.

## YAML example

Replace the example IDs with entities from your instance. `calendar_colors` is optional. Quote hex colors so YAML treats them as values.

```yaml
type: custom:family-hub-live
calendars:
  - calendar.family
  - calendar.school
calendar_colors:
  calendar.family: "#4a90e2"
  calendar.school: "#2ba675"
actions:
  - light.living_room
action_appearance:
  light.living_room:
    icon: mdi:lamps
    off_color: "#64748b"
    on_color: "#f59e0b"
widgets:
  - sensor.outdoor_temperature
weather_entity: weather.home
default_view: month
ribbon_default: collapsed
widget_layout: grid
```
