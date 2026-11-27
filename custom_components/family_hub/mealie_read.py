"""Read Mealie through Home Assistant's configured integration."""

from asyncio import gather
from datetime import date
import re
from urllib.parse import urlsplit

import voluptuous as vol

from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN

OPTION = "mealie_read"
PAGE_SIZE = 8
SEARCH_LIMIT = 100
SEGMENT = re.compile(r"[a-zA-Z0-9_-]{1,200}")


def dinner_entry(hass, calendar):
    """Resolve the configured Dinner calendar against the entity registry."""
    entity = er.async_get(hass).async_get(calendar)
    if (
        not entity or entity.disabled or entity.domain != "calendar"
        or entity.platform != "mealie" or entity.translation_key != "dinner"
        or not entity.config_entry_id
    ):
        return None
    entry = hass.config_entries.async_get_entry(entity.config_entry_id)
    if entry and entry.domain == "mealie" and entry.state is ConfigEntryState.LOADED:
        return entry
    return None


def valid_link(url, group):
    """Validate the optional browser link base and group slug."""
    if not url and not group:
        return True
    if not SEGMENT.fullmatch(group) or re.search(r"[\s\\]", url):
        return False
    try:
        parts = urlsplit(url)
        return (
            parts.scheme in ("http", "https") and bool(parts.hostname)
            and parts.username is None and not parts.query and not parts.fragment
            and (parts.port is None or 0 < parts.port < 65536)
        )
    except ValueError:
        return False


async def read(hass, entry, action, data, context=None):
    """Call a supported Mealie action with the resolved connection."""
    from aiomealie import MealieError

    try:
        return await hass.services.async_call(
            "mealie", action, {"config_entry_id": entry.entry_id, **data},
            blocking=True, return_response=True, context=context,
        )
    except MealieError as err:
        raise HomeAssistantError("Mealie request failed") from err


async def mealplan(hass, entry, day, context):
    return await read(
        hass, entry, "get_mealplan", {"start_date": day, "end_date": day}, context,
    )


def is_dinner_recipe(plan, day, recipe_id):
    for meal in plan.get("mealplan", []):
        recipe = meal.get("recipe")
        if (
            recipe and str(meal.get("mealplan_date")) == day.isoformat()
            and meal.get("entry_type") == "dinner"
            and recipe_id in (recipe.get("recipe_id"), recipe.get("slug"))
        ):
            return True
    return False


async def favorite_ids(entry):
    """Use the native favorites of the account connected to Home Assistant."""
    from aiomealie import MealieError

    client = entry.runtime_data.client
    if not hasattr(client, "get_recipe_favorites"):
        raise HomeAssistantError("Mealie favorites require an updated Home Assistant")
    try:
        favorites = await client.get_recipe_favorites()
    except MealieError as err:
        raise HomeAssistantError("Mealie favorites could not be read") from err
    return list(dict.fromkeys(
        rating.recipe_id for rating in favorites.ratings
        if rating.is_favorite and SEGMENT.fullmatch(rating.recipe_id)
    ))


def summary(recipe):
    """Send only fields used by the recipe browser."""
    return {field: recipe.get(field) for field in ("recipe_id", "name", "slug", "total_time")}


async def browse(hass, entry, operation, value, page, context):
    """Read a bounded search or a page of native favorites."""
    if operation == "search":
        if not value.strip():
            raise ValueError
        result = await read(hass, entry, "get_recipes", {
            "search_terms": value.strip(), "result_limit": SEARCH_LIMIT,
        }, context)
        items = result["recipes"]["items"]
        return {"items": [summary(recipe) for recipe in items[:SEARCH_LIMIT]]}

    ids = await favorite_ids(entry)
    start = (page - 1) * PAGE_SIZE

    async def favorite(recipe_id):
        result = await read(hass, entry, "get_recipe", {"recipe_id": recipe_id}, context)
        return summary(result["recipe"])

    results = await gather(*(favorite(recipe_id) for recipe_id in ids[start:start + PAGE_SIZE]),
                           return_exceptions=True)
    if any(isinstance(result, Exception) for result in results):
        raise HomeAssistantError("Unable to read one or more favorite recipes")
    return {"items": results, "has_more": start + PAGE_SIZE < len(ids)}


@websocket_api.websocket_command({
    vol.Required("type"): "family_hub/mealie_read",
    vol.Required("operation"): vol.In(("settings", "mealplan", "recipe", "search", "favorites")),
    vol.Optional("calendar"): str,
    vol.Optional("day"): vol.All(str, vol.Length(min=10, max=10)),
    vol.Optional("page", default=1): vol.All(int, vol.Range(min=1, max=1000)),
    vol.Optional("value"): vol.All(str, vol.Length(max=200)),
})
@websocket_api.async_response
async def ws_read(hass, connection, msg):
    """Expose only the configured read operations to calendar readers."""
    entry = next(
        (entry for entry in hass.config_entries.async_entries(DOMAIN)
         if entry.state is ConfigEntryState.LOADED),
        None,
    )
    settings = entry.options.get(OPTION, {}) if entry else {}
    calendar = settings.get("calendar")
    if not calendar:
        connection.send_result(msg["id"], None)
        return
    if not connection.user.permissions.check_entity(calendar, POLICY_READ):
        connection.send_error(msg["id"], "unauthorized", "Cannot read the dinner calendar")
        return
    mealie = dinner_entry(hass, calendar)
    if mealie is None:
        connection.send_error(msg["id"], "not_found", "Mealie Dinner calendar unavailable")
        return
    operation = msg["operation"]
    if operation == "settings":
        connection.send_result(msg["id"], {
            "calendar": calendar, "url": settings.get("url"), "group": settings.get("group"),
            "browse": bool(settings.get("browse")),
        })
        return
    if msg.get("calendar") != calendar:
        connection.send_error(msg["id"], "not_found", "The configured Mealie calendar changed")
        return
    if operation in ("search", "favorites") and not settings.get("browse"):
        connection.send_error(msg["id"], "unauthorized", "Recipe browsing is disabled")
        return
    context = Context(user_id=connection.user.id)
    value = msg.get("value", "")
    try:
        if operation == "mealplan":
            result = await mealplan(hass, mealie, date.fromisoformat(value), context)
        elif operation in ("search", "favorites"):
            result = await browse(hass, mealie, operation, value, msg["page"], context)
        else:
            if not SEGMENT.fullmatch(value):
                raise ValueError
            if not settings.get("browse"):
                day = date.fromisoformat(msg.get("day", ""))
                if not is_dinner_recipe(await mealplan(hass, mealie, day, context), day, value):
                    connection.send_error(msg["id"], "unauthorized", "Recipe is outside the dinner plan")
                    return
            result = await read(hass, mealie, "get_recipe", {"recipe_id": value}, context)
    except ValueError:
        connection.send_error(msg["id"], "invalid_format", "Invalid Mealie request")
        return
    except HomeAssistantError:
        connection.send_error(msg["id"], "mealie_unavailable", "Mealie request failed")
        return
    connection.send_result(msg["id"], result)
