"""Fixed capabilities of the reduced fork; browser settings cannot enable them."""
from __future__ import annotations

from functools import wraps

PROFILE = "reduced-local-first"
ENABLE_GROCY = False
PLATFORMS = ("todo", "sensor", "button", "select", "number", "text", "switch")
MAX_SETTINGS_BYTES = 512 * 1024
MAX_DEVICES = 32
MAX_INSTANCES_PER_DEVICE = 16
MAX_DEVICE_ID_LENGTH = 128


def disabled_feature(handler):
    """Replace an excluded WebSocket operation before HA schedules its body.

    Preserve HA's command/schema metadata. Reads return empty capability data
    for existing cards; mutations fail explicitly. Neither invokes the handler.
    """
    @wraps(handler)
    def blocked(hass, connection, msg):
        command = msg.get("type", "")
        if command.rsplit("/", 1)[-1].startswith(("get_", "list", "status")):
            connection.send_result(msg["id"], {
                "disabled": True, "configured": False, "success": False,
                "migrated": True, "recipes": [], "suggestions": [],
                "items": [], "lists": [], "locations": [], "status": {},
            })
        else:
            connection.send_error(msg["id"], "feature_disabled", "This feature is disabled in this Family Hub version.")
    return blocked


def can_access_device(connection, record):
    """Device IDs identify a record; they do not grant access to it."""
    user = connection.user
    return bool(user and (user.is_admin or record.get("owner_user_id") == user.id))
