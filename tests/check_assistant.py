"""Check the Assistant handlers against HA Core with a synthetic AI and calendar."""

import asyncio
from io import BytesIO
import json
from datetime import datetime
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from homeassistant.components.calendar.const import DATA_COMPONENT
from homeassistant.components.calendar.services import CREATE_EVENT_SCHEMA
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER
from homeassistant.core import Context, HomeAssistant

from PIL import Image

from custom_components.family_hub import assistant, vision
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

    async def test_image_draft_requires_edits_and_explicit_confirmation(self):
        extracted = {
            "status": "draft", "title": "Library workshop", "start": "2026-12-05",
            "end": "", "location": "Main library", "description": "Bring a notebook",
            "all_day": False, "duration_minutes": 0, "confidence": "low",
            "ambiguities": "The image does not give a time.",
        }
        provider = SimpleNamespace(
            show=AsyncMock(return_value=SimpleNamespace(
                capabilities=["vision"], modelinfo={"general.architecture": "example"},
            )),
            chat=AsyncMock(return_value=SimpleNamespace(
                message=SimpleNamespace(content=json.dumps({
                    **{key: value for key, value in extracted.items() if key not in ("start", "end")},
                    "start_date": "2026-12-05", "start_time": "", "end_date": "", "end_time": "",
                })),
            )),
        )
        source = BytesIO()
        Image.new("RGB", (40, 40), "white").save(source, "PNG")

        async def chunks(_):
            yield source.getvalue()

        class Upload(dict):
            content_length = len(source.getvalue())
            content = SimpleNamespace(iter_chunked=chunks)

        upload = Upload({KEY_HASS: self.hass, KEY_HASS_USER: self.connection.user})
        view = assistant.AssistantImageView()
        self.options.pop("ai_task")
        with (
            patch.object(assistant, "_vision_task_id", return_value="ai_task.vision"),
            patch.object(vision, "ollama_task", return_value=(provider, "vision:test")),
        ):
            response = await view.post(upload)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(json.loads(response.body)["draft"], extracted)
            provider.show.assert_awaited_once_with("vision:test")
            payload = provider.chat.await_args.kwargs
            self.assertEqual(payload["model"], "vision:test")
            self.assertTrue(payload["messages"][0]["images"][0].startswith(b"\xff\xd8"))
            self.assertNotIn("calendar.family", payload["messages"][0]["content"])
            self.assertNotIn("tools", payload)
            self.assertFalse(self.runtime.get("assistant_pending"))
            self.service.assert_not_awaited()

            event = {key: value for key, value in extracted.items()
                     if key not in ("status", "confidence", "ambiguities")}
            message = {"id": 2, "event": event, "calendar": ""}
            await assistant.ws_review_image_event.__wrapped__(self.hass, self.connection, message)
            self.assertEqual(self.connection.result["status"], "clarify_image")
            event["start"] += "T14:00"
            await assistant.ws_review_image_event.__wrapped__(self.hass, self.connection, message)
            self.assertEqual(self.connection.result["status"], "clarify_image")
            event.update(duration_minutes=90, title="Edited workshop")
            await assistant.ws_review_image_event.__wrapped__(self.hass, self.connection, message)
            proposal = self.connection.result
            self.assertEqual(proposal["status"], "proposal")
            self.assertEqual(proposal["event"]["summary"], "Edited workshop")
            self.assertEqual(proposal["event"]["end_date_time"], "2026-12-05T15:30:00-06:00")
            self.service.assert_not_awaited()

            await assistant.ws_confirm.__wrapped__(
                self.hass, self.connection, {"id": 3, "proposal_id": proposal["id"]},
            )
            self.assertEqual(self.connection.result["status"], "created")
            self.service.assert_awaited_once()
            self.assertEqual(self.service.await_args.args[:2], ("calendar", "create_event"))
            CREATE_EVENT_SCHEMA(self.service.await_args.args[2])

            self.connection.allowed = False
            self.assertEqual(json.loads((await view.post(upload)).body)["status"], "unavailable")
            provider.chat.assert_awaited_once()

    async def test_vision_rejects_text_only_and_malformed_output(self):
        provider = SimpleNamespace(
            show=AsyncMock(return_value=SimpleNamespace(capabilities=["completion"])),
            chat=AsyncMock(),
        )
        with self.assertRaisesRegex(vision.VisionError, "^vision_unsupported_model$"):
            await vision.extract(provider, "text:test", b"image", "UTC")
        provider.chat.assert_not_awaited()
        provider.show.return_value = SimpleNamespace(capabilities=["vision"], modelinfo={})
        with self.assertRaisesRegex(vision.VisionError, "^vision_unsupported_model$"):
            await vision.extract(provider, "remote-alias:test", b"image", "UTC")
        provider.chat.assert_not_awaited()
        provider.show.return_value.modelinfo = {"general.architecture": "example"}
        provider.chat.return_value = SimpleNamespace(message=SimpleNamespace(content="not JSON"))
        with self.assertRaisesRegex(vision.VisionError, "^vision_invalid_output$"):
            await vision.extract(provider, "vision:test", b"image", "UTC")
        with self.assertRaisesRegex(vision.VisionError, "^invalid_image$"):
            vision.clean_image(b"not an image")

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
