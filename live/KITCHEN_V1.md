# Kitchen V1 design for review

Kitchen would give the household one place to see upcoming meals and the current Mealie shopping list. The existing Week and Month views would keep showing meals alongside the rest of the family calendar. Mealie would still own meal planning, recipe editing, and shopping data.

## Current Home Assistant support

Verified against Home Assistant Core 2026.11.2. The native integration requires Mealie 3.2.0 or later. It stores the Mealie API token in the Home Assistant integration configuration and connects from the server. Entity IDs are assigned by Home Assistant and may be renamed, so use the configured entities for the intended Mealie instance. [Integration documentation](https://www.home-assistant.io/integrations/mealie/)

| Surface | What it provides |
| --- | --- |
| `calendar.*` | Read-only Breakfast, Lunch, Dinner, and Side calendars. Mealie 3.7.0 and later also support Dessert, Drink, and Snack. The hour-long coordinator refresh supports the next-event state. Calendar range reads query Mealie directly and return all-day event summaries and descriptions without structured recipe IDs or images. |
| `todo.*` | One entity per shopping list, refreshed every five minutes. The state is the count of incomplete items. Generic list items provide display summary, UID, and completion status. Mealie supports create, update, delete, and move through the to-do entity. Food recognition can turn an edited item into a note if the match fails or parsing is disabled. |
| `sensor.*` | Counts of recipes, categories, tags, tools, and users, refreshed every 15 minutes. There is no pantry inventory sensor or favorites entity. |

[Calendar source](https://github.com/home-assistant/core/blob/2026.11.2/homeassistant/components/mealie/calendar.py) · [To-do source](https://github.com/home-assistant/core/blob/2026.11.2/homeassistant/components/mealie/todo.py) · [Refresh intervals](https://github.com/home-assistant/core/blob/2026.11.2/homeassistant/components/mealie/coordinator.py)

| Action | Inputs and output relevant to Kitchen |
| --- | --- |
| `calendar.get_events` | Target calendar entities and request a date/time range. Returns per-calendar events. Use for calendar fallback if recipe metadata is unavailable. |
| `mealie.get_mealplan` | `config_entry_id`, optional `start_date` and `end_date` (each defaults to today). Returns `mealplan` with dated, typed entries that can contain a recipe or a note. Pass both bounds explicitly. |
| `mealie.get_recipe` | `config_entry_id` and `recipe_id` (ID or slug). Returns `recipe`, including ingredient data where present. Useful for an on-demand recipe view. |
| `mealie.get_recipes` | `config_entry_id`, optional `search_terms` and `result_limit` (defaults to 10). Returns `recipes` search results. No exposed sort-by-recent or favorites filter. |
| `todo.get_items` | Target a selected `todo.*` entity, optionally with `status: needs_action`. Returns an item array keyed by entity ID. Prefer this for the shared list display. |
| `mealie.get_shopping_list_items` | Target a Mealie-backed `todo.*` entity for raw structured Mealie items, including food and unit data when present. The entity handler returns the list name and items. This is the existing list and its contents can span meals outside the selected horizon. |
| `mealie.parse_ingredient`, `mealie.add_ingredient` | Parse text with the selected config entry or add a structured food/unit/quantity or note to a targeted shopping list. |
| `todo.add_item`, `todo.update_item`, `todo.remove_item`, `todo.remove_completed_items` | Generic list mutations. Updating an item by UID can set its completion status. |
| `mealie.import_recipe`, `mealie.set_mealplan`, `mealie.set_random_mealplan`, `mealie.update_mealplan`, `mealie.delete_mealplan` | Write actions available in Home Assistant. Kitchen V1 can leave these edits in Mealie. |

[Mealie action registrations and schemas](https://github.com/home-assistant/core/blob/2026.11.2/homeassistant/components/mealie/services.py) · [Calendar documentation](https://www.home-assistant.io/integrations/calendar/) · [To-do documentation](https://www.home-assistant.io/integrations/todo/)

## Existing Family Hub Live data flow

Home Assistant registers `/family_hub/family-hub-live.js` as a dashboard resource. The card uses the signed-in dashboard context to request visible ranges via `GET calendars/<entity_id>`, mapping results to the Home Assistant time zone. One in-memory event collection feeds Week, Month, and day details, and the legend filters it locally. Daily weather comes from `weather/subscribe_forecast`. Native widgets receive the same `hass` object through card helpers.

The optional existing `mealie` block enriches day details for one configured calendar. Opening details calls `mealie.get_mealplan` through Home Assistant's authenticated WebSocket for that date. The card caches results for five minutes and matches dinner recipes by name. It skips ambiguous matches. It opens a recipe using the configured browser-reachable base URL and group slug. Existing thumbnails load directly from that origin using the recipe ID, with a link fallback when loading fails. The Mealie API token configured in Home Assistant stays on the server. See [the card source](../custom_components/family_hub/card/family-hub-live.js).

## Proposed V1

- Add a **Kitchen** entry to Family Hub Live when Kitchen is configured. Open a dedicated panel with **Upcoming meals** and **Shopping**, while preserving the current calendar view, date, and filter on return.
- Default to seven consecutive days starting today in Home Assistant's time zone. Allow an initial preference of 7, 14, or 30 days and a switch within the panel. Show the visible date range, including today through today plus the selected number of days minus one. Use one authenticated `mealie.get_mealplan` call per range and group by date and meal type. Preserve meal notes, order entries deterministically, and discard entries outside the requested dates. Use explicit meal calendar entities for an optional fallback.
- Use one explicitly selected Mealie-backed `todo.*` for the current shopping list. Read incomplete items through `todo.get_items`. Label it with the list name and keep the date selector scoped to meals. Start read-only with a link to manage the list in Mealie. If check-off is approved, target that entity and its stable item UID, then reconcile the server result. Keep a shared list separate from any future generated meal ingredients. Ingredient aggregation would need quantity and unit normalization, servings, exclusions, duplicates, and pantry assumptions.
- Keep **Recipes** optional and off by default. A recent option can derive distinct recipes from a bounded lookback of scheduled meals, labeled **Recently planned**. For favorites, use a household-curated selection or defer until a supported favorites source is verified. Bound the section to a configurable 6, 10, or 20 entries.
- Fetch on open, range change, and explicit refresh. Use short in-memory caching keyed by instance and date range, with independent loading, empty, and error states for each section. Discard late responses when the range or configuration changes. Test with multiple instances, a non-admin wall tablet account, local and remote access, date rollover and permission failures before shipping.

## Images and authorization

Start with optional links that use the browser's normal Mealie access. Keep thumbnails disabled by default for Kitchen. If enabled, a browser may render a thumbnail from a trusted, browser-reachable HTTPS Mealie origin when its permissions and session permit it. Use a fixed media path, validated IDs, no-referrer loading, and text and links when an image is unavailable. Home Assistant accessibility alone does not make a LAN Mealie origin accessible remotely.

For private images through Home Assistant, consider a later authenticated server-side proxy with an explicitly bound Mealie instance and user authorization on every request. Resolve the destination from trusted server configuration, use verified TLS, validate media IDs, constrain redirects, response size, media type, and cache lifetime, and recheck permissions on cache hits. Keep Mealie credentials out of card YAML, browser code, query parameters, logs, and screenshots. An unauthenticated static frontend resource or a generic URL proxy would expose a private media path.

Use the signed-in Home Assistant account for both read paths. A config entry ID selects an instance and should never be treated as an authorization check. Before implementation, verify whether the household account can call the native response actions and whether the instance-scoped meal call fits the household's access model. Prefer entity-scoped access where tighter isolation is required. [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/)

## Decisions for review

Approve the rolling seven-day default, one selected read-only shopping list, and optional link-first recipe details. Decide whether to include recently planned recipes in the initial release and which dashboard account should have access. Implementation follows the architecture review.
