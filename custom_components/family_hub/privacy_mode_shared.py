"""Shared write-and-broadcast helper for Privacy Mode - see PRIVACY_MODE_EVENT_CHANGED's own comment in const.py for the feature itself."""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from .const import PRIVACY_MODE_EVENT_CHANGED


async def async_set_privacy_mode(hass: HomeAssistant, entry_data: dict[str, Any], enabled: bool) -> None:
    state = entry_data.setdefault("privacy_mode", {"enabled": False})
    state["enabled"] = bool(enabled)
    store = entry_data.get("privacy_mode_store")
    if store is not None:
        await store.async_save(state)
    hass.bus.async_fire(PRIVACY_MODE_EVENT_CHANGED, {"enabled": bool(enabled)})


async def async_require_privacy_unlock(hass, entry_data, context):
    """The same policy for privacy switches and WebSocket commands.

    Automations without an authenticated user retain their authority. Browser
    callers cannot bypass the permission check using the switch entities.
    """
    from homeassistant.exceptions import HomeAssistantError
    from .const import PERMISSION_TOGGLE_PRIVACY_MODE

    user_id = getattr(context, "user_id", None)
    if user_id is None:
        return
    user = await hass.auth.async_get_user(user_id)
    grants = (entry_data.get("permissions") or {}).get(user_id) or {}
    if not user or not (user.is_admin or grants.get(PERMISSION_TOGGLE_PRIVACY_MODE)):
        raise HomeAssistantError("You cannot disable privacy mode.")
