"""Linked wish lists (2026.11.1): the Home Assistant side.

Reads each person's ``wishlistLinks`` (from their profile in the household
settings), fetches them with ``wishlist_import`` and puts the items on their own
wish list (``wishlistEntity``) with the ``todo`` services. Runs every
``SYNC_EVERY_HOURS``, shortly after start-up, after a save that changes
someone's links, and on demand from Settings (``family_hub/wishlist_links/sync``).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from . import wishlist_import as wi

_LOGGER = logging.getLogger(__name__)
STORE_VERSION = 1


def store_for(hass: HomeAssistant, entry_id: str) -> Store:
    return Store(hass, STORE_VERSION, f"family_hub_wishlist_links_{entry_id}")


def _profiles(settings: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = settings.get("userProfiles") if isinstance(settings, dict) else None
    return {str(k): v for k, v in raw.items() if isinstance(v, dict)} if isinstance(raw, dict) else {}


def links_by_user(settings: dict[str, Any]) -> dict[str, list[str]]:
    return {uid: wi.normalize_links(p.get("wishlistLinks")) for uid, p in _profiles(settings).items()}


async def _todo_items(hass: HomeAssistant, entity_id: str) -> list[dict[str, Any]]:
    response = await hass.services.async_call(
        "todo", "get_items", {"entity_id": entity_id, "status": ["needs_action", "completed"]},
        blocking=True, return_response=True,
    )
    return list(((response or {}).get(entity_id) or {}).get("items") or [])


async def async_sync(hass: HomeAssistant, entry_data: dict[str, Any], only_user: str | None = None) -> dict[str, Any]:
    """External wishlist synchronization is excluded from this fork."""
    return {}


def schedule_sync(hass: HomeAssistant, entry_data: dict[str, Any], only_user: str | None = None) -> None:
    """External wishlist tasks and commands are not registered."""
    return


def changed_users(old_settings: dict[str, Any], new_settings: dict[str, Any]) -> list[str]:
    old, new = links_by_user(old_settings or {}), links_by_user(new_settings or {})
    old_entities = {u: str(p.get("wishlistEntity") or "") for u, p in _profiles(old_settings or {}).items()}
    new_entities = {u: str(p.get("wishlistEntity") or "") for u, p in _profiles(new_settings or {}).items()}
    users = set(old) | set(new)
    return sorted(u for u in users if old.get(u, []) != new.get(u, []) or (new.get(u) and old_entities.get(u) != new_entities.get(u)))


def _entry_data(hass: HomeAssistant) -> dict[str, Any] | None:
    entries = (hass.data.get("family_hub") or {}).get("entries") or {}
    return next(iter(entries.values()), None) if entries else None


@websocket_api.websocket_command({vol.Required("type"): "family_hub/wishlist_links/status"})
@websocket_api.async_response
async def ws_status(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    entry_data = _entry_data(hass)
    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Family Hub is not set up")
        return
    saved = await entry_data["wishlist_links_store"].async_load() or {}
    connection.send_result(msg["id"], {"status": saved.get("status") or {}})


@websocket_api.websocket_command({vol.Required("type"): "family_hub/wishlist_links/sync", vol.Optional("user_id"): str})
@websocket_api.async_response
async def ws_sync(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    entry_data = _entry_data(hass)
    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Family Hub is not set up")
        return
    status = await async_sync(hass, entry_data, msg.get("user_id") or None)
    connection.send_result(msg["id"], {"status": status})


def register(hass: HomeAssistant) -> None:
    """External wishlist tasks and commands are not registered."""
    return
