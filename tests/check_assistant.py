"""Check the Assistant handlers against HA Core with a synthetic AI and calendar."""

import asyncio
from datetime import datetime
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from homeassistant.components.calendar.const import DATA_COMPONENT
from homeassistant.components.calendar.services import CREATE_EVENT_SCHEMA
from homeassistant.core import Context, HomeAssistant

from custom_components.family_hub import assistant
from custom_components.family_hub.const import DOMAIN, PERMISSION_EDIT_EVENT


class Connection:
    def __init__(self, user_id):
        self.allowed = True
        self.user = SimpleNamespace(
            id=user_id, name=user_id, is_admin=False,
            permissions=SimpleNamespace(check_entity=lambda *args: self.allowed),
        )
        self.result = None

    def send_result(self, msg_id, result=None):
        self.result = result

    def context(self, msg):
        return Context(user_id=self.user.id)


class AssistantTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.hass = HomeAssistant(folder.name)
        self.hass.config.time_zone = "America/Chicago"
        self.hass.states.async_set("calendar.family", "off", {"supported_features": 1})
        self.hass.states.async_set("calendar.read_only", "off")
        self.hass.states.async_set("ai_task.ollama", "unknown")
        self.options = {"enabled": True, "calendars": ["calendar.family", "calendar.read_only"],
                        "ai_task": "ai_task.ollama"}
        self.runtime = {"permissions": {"onlooker": {PERMISSION_EDIT_EVENT: True},
                                        "other": {PERMISSION_EDIT_EVENT: True}}}
        self.hass.data[DOMAIN] = {"entries": {"test": self.runtime}}
        entry = SimpleNamespace(entry_id="test", options={assistant.OPTION: self.options})
        self.hass.config_entries = SimpleNamespace(async_entries=lambda domain: [entry])
        self.connection = Connection("onlooker")
        self.model_result = {
            "status": "event", "title": "Soccer", "calendar": "", "start": "2026-11-23T18:00",
            "end": "", "description": "Bring water", "location": "",
        }
        self.service = AsyncMock(return_value={"data": self.model_result})
        self.hass.services = SimpleNamespace(async_call=self.service, has_service=lambda *_: False)

    async def propose(self):
        await assistant.ws_propose.__wrapped__(
            self.hass, self.connection, {"id": 1, "text": "Soccer tomorrow at 6 PM", "calendar": ""},
        )
        return self.connection.result

    async def test_preview_and_single_calendar_write_with_signed_in_actor(self):
        preview = await self.propose()
        self.assertEqual(preview["status"], "proposal")
        self.assertEqual(preview["default_minutes"], 60)
        self.assertEqual(preview["event"]["end_date_time"], "2026-11-23T19:00:00-06:00")
        self.assertEqual(self.service.await_count, 1)
        self.assertEqual(self.service.await_args.args[:2], ("ai_task", "generate_data"))
        self.assertNotIn("read_only", self.service.await_args.args[2]["instructions"])
        message = {"id": 2, "proposal_id": preview["id"]}
        other = Connection("other")
        await assistant.ws_confirm.__wrapped__(self.hass, other, message)
        self.assertEqual(other.result["status"], "expired")
        self.assertEqual(self.service.await_count, 1)

        entered, finish = asyncio.Event(), asyncio.Event()

        async def write(domain, service, data, *, blocking, context):
            self.assertEqual((domain, service), ("calendar", "create_event"))
            self.assertEqual(context.user_id, "onlooker")
            self.assertEqual(data, {"entity_id": "calendar.family", **preview["event"]})
            CREATE_EVENT_SCHEMA(data)
            entered.set()
            await finish.wait()

        self.service.side_effect = write
        original = asyncio.create_task(assistant.ws_confirm.__wrapped__(self.hass, self.connection, message))
        await asyncio.wait_for(entered.wait(), 1)
        await assistant.ws_confirm.__wrapped__(self.hass, self.connection, message)
        self.assertEqual(self.connection.result["status"], "saving")
        finish.set()
        await original
        self.assertEqual(self.connection.result["status"], "created")
        await assistant.ws_confirm.__wrapped__(self.hass, self.connection, message)
        self.assertEqual(self.connection.result["status"], "created")
        self.assertEqual(self.service.await_count, 2)

    async def test_confirm_refreshes_target_when_provider_listing_is_delayed(self):
        preview = await self.propose()
        fields = preview["event"]
        event = SimpleNamespace(
            summary=fields["summary"], description=fields["description"], location=None,
            start=datetime.fromisoformat(fields["start_date_time"]),
            end=datetime.fromisoformat(fields["end_date_time"]),
        )
        visible = asyncio.Event()

        async def get_events(hass, start, end):
            self.assertEqual((start, end), (event.start, event.end))
            if entity.async_update_ha_state.await_count == 2:
                visible.set()
                return [event]
            return []

        entity = SimpleNamespace(async_update_ha_state=AsyncMock(), async_get_events=get_events)

        def get_entity(entity_id):
            self.assertEqual(entity_id, "calendar.family")
            return entity

        self.hass.data[DATA_COMPONENT] = SimpleNamespace(get_entity=get_entity)
        with patch.object(assistant, "CALENDAR_REFRESH_DELAYS", (0, 0, 0)):
            await assistant.ws_confirm.__wrapped__(
                self.hass, self.connection, {"id": 2, "proposal_id": preview["id"]},
            )
            self.assertEqual(self.connection.result, {
                "status": "created", "calendar_id": "calendar.family", "event": fields,
            })
            await asyncio.wait_for(visible.wait(), 1)
        self.assertEqual(entity.async_update_ha_state.await_count, 2)
        entity.async_update_ha_state.assert_awaited_with(force_refresh=True)
        self.assertEqual(self.service.await_count, 2)

    async def test_permissions_and_cancel_are_enforced_before_writing(self):
        preview = await self.propose()
        message = {"id": 2, "proposal_id": preview["id"]}
        self.connection.allowed = False
        await assistant.ws_confirm.__wrapped__(self.hass, self.connection, message)
        self.assertEqual(self.connection.result["status"], "unavailable")
        self.connection.allowed = True
        self.options["calendars"].remove("calendar.family")
        await assistant.ws_confirm.__wrapped__(self.hass, self.connection, message)
        self.assertEqual(self.connection.result["status"], "unavailable")
        self.options["calendars"].append("calendar.family")
        await assistant.ws_cancel.__wrapped__(self.hass, self.connection, message)
        await assistant.ws_confirm.__wrapped__(self.hass, self.connection, message)
        self.assertEqual(self.connection.result["status"], "expired")
        self.runtime["permissions"].clear()
        self.assertEqual((await self.propose())["status"], "unavailable")
        self.assertEqual(self.service.await_count, 1)

    async def test_timed_ambiguity_all_day_exclusive_and_invalid_fields(self):
        zone = ZoneInfo("America/Chicago")
        self.model_result["start"] = "2026-11-01T01:30"
        self.assertEqual((await self.propose())["status"], "clarify")
        self.model_result["start"] = "2026-03-08T02:30"
        self.assertEqual((await self.propose())["status"], "clarify")
        self.model_result["start"] = "2026-11-24"
        preview = await self.propose()
        self.assertEqual(preview["event"]["end_date"], "2026-11-25")
        self.model_result["entity_id"] = "calendar.read_only"
        self.assertEqual((await self.propose())["status"], "invalid_output")
        self.assertEqual(assistant._local_time("2026-11-23T18:00", zone),
                         datetime.fromisoformat("2026-11-24T00:00:00+00:00"))

    async def test_failed_write_reports_uncertainty_without_retry(self):
        preview = await self.propose()
        message = {"id": 2, "proposal_id": preview["id"]}
        self.service.side_effect = TimeoutError
        for _ in range(2):
            await assistant.ws_confirm.__wrapped__(self.hass, self.connection, message)
            self.assertEqual(self.connection.result["status"], "uncertain")
        self.assertEqual(self.service.await_count, 2)
