# Family Hub Live

Update the `rmasonIV/HA-Family-Hub` integration in HACS to 2026.11.1.2 or newer, then restart Home Assistant. Family Hub registers the card automatically for UI-managed dashboard resources.

On your production dashboard, enter edit mode and add **Family Hub Live** from the card picker. A Panel view gives it the full width. Select your calendars, Quick Actions and Quick Widgets in the card editor. Once you have saved those settings, remove the previous calendar card or replace it directly using the YAML below.

```yaml
type: custom:family-hub-live
calendars: []
actions: []
widgets: []
default_view: week
widget_layout: grid
```

Use your Home Assistant entity IDs in the three lists. The editor accepts up to four actions and four widgets. To use YAML-managed Lovelace resources, add `/family_hub/family-hub-live.js` as a JavaScript module. If you previously added the manual `/local/family-hub-live/` resource, remove that resource to load the integration-managed version.

Quick Actions can toggle lights and switches, run scripts, press buttons, and open closed covers after confirmation. Quick Widgets display the current state of each selected entity. Week and Month show live events from the selected calendars.
